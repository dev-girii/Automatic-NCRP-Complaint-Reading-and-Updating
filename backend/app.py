from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import os
import shutil
from werkzeug.utils import secure_filename
import tempfile
import traceback
import datetime
import subprocess
app = Flask(__name__)
CORS(app)

import ncrp_script as ncrp
import pandas as pd

# Base data path: C:\NCRP (or NCRP_DATA_PATH env when set by Electron)
BASE_DATA_PATH = os.environ.get('NCRP_DATA_PATH', r'C:\NCRP')
os.makedirs(BASE_DATA_PATH, exist_ok=True)

# Upload folder (permanent storage after approval)
UPLOAD_FOLDER = os.path.join(BASE_DATA_PATH, 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
INDEX_FILE = os.path.join(UPLOAD_FOLDER, 'file_index.json')

# Temp/pending folder (files stored here until approved)
PENDING_FOLDER = os.path.join(BASE_DATA_PATH, 'pending')
os.makedirs(PENDING_FOLDER, exist_ok=True)

# SQLite database
DATA_DB_PATH = os.path.join(BASE_DATA_PATH, 'data.db')
DB_TABLE = 'ncrp_complaints'


def init_sqlite_db():
    """Create SQLite table if it doesn't exist."""
    import sqlite3
    conn = sqlite3.connect(DATA_DB_PATH)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS {DB_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT,
            complaint_id TEXT UNIQUE,
            complaint_date TEXT,
            incident_datetime TEXT,
            mobile TEXT,
            email TEXT,
            full_address TEXT,
            district TEXT,
            state TEXT,
            cybercrime_type TEXT,
            platform TEXT,
            total_amount_lost REAL,
            current_status TEXT,
            saved_filename TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.commit()
    conn.close()

import json

@app.route("/api/generate_letters", methods=["POST"])
def generate_letter():
    """Receive a complaint ID plus an Excel/CSV file and generate letters.

    Expects multipart/form-data with fields:
      - complaint_id
      - file (the excel/csv document)
    The complaint ID is used to locate the uploaded PDF (via the index file).
    Generated word documents are written under ``$BASE_DATA_PATH/letters/<cid>``
    and the API responds with a JSON summary of the created filenames.  No
    files are returned to the client; this keeps the backend simple and allows
    the frontend to acknowledge success once the process completes.
    """
    try:
        # complaint id may be sent via form or JSON
        complaint_id = None
        if request.content_type and 'multipart/form-data' in request.content_type:
            complaint_id = request.form.get('complaint_id')
            upload = request.files.get('file') or request.files.get('excel')
        else:
            data = request.get_json(silent=True) or {}
            complaint_id = data.get('complaint_id')
            upload = None

        if not complaint_id:
            return jsonify({'error': 'complaint_id is required'}), 400

        if not upload:
            return jsonify({'error': 'no file uploaded'}), 400

        # save the uploaded spreadsheet to a temporary location
        fd, temp_path = tempfile.mkstemp(suffix=os.path.splitext(upload.filename)[1])
        os.close(fd)
        upload.save(temp_path)

        # look up PDF path corresponding to complaint_id
        pdf_path = None
        try:
            if os.path.exists(INDEX_FILE):
                with open(INDEX_FILE, 'r', encoding='utf-8') as fh:
                    idx = json.load(fh) or {}
                fname = idx.get(str(complaint_id))
                if fname:
                    candidate = os.path.join(UPLOAD_FOLDER, fname)
                    if os.path.exists(candidate):
                        pdf_path = candidate
        except Exception:
            app.logger.exception('Error reading index file while generating letters')

        if not pdf_path:
            return jsonify({'error': 'no PDF found for complaint_id'}), 404

        # call generation function
        from generate_letters import generate_letters_from_files

        # make a per-complaint output directory; allow override via LETTERS_PATH
        output_base = os.environ.get('LETTERS_PATH', os.path.join(BASE_DATA_PATH, 'letters'))
        os.makedirs(output_base, exist_ok=True)
        output_dir = os.path.join(output_base, str(complaint_id))
        os.makedirs(output_dir, exist_ok=True)

        generated_files = generate_letters_from_files(pdf_path, temp_path, output_dir=output_dir)

        # cleanup uploaded temp spreadsheet
        try:
            os.remove(temp_path)
        except Exception:
            pass

        if not generated_files:
            return jsonify({'error': 'no letters were generated (check template?)'}), 500

        # don't send the files back; just return names so client can show ack
        return jsonify({'generated': [os.path.basename(f) for f in generated_files]}), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    
@app.route('/api/upload', methods=['POST'])
def api_upload():
    """Accept multipart/form-data files under 'files' and process them with existing extractor.
    Files are saved to PENDING folder (not uploads) until approved via /api/verify.
    Returns extracted rows for verification by the frontend.
    """
    try:
        files = request.files.getlist('files')
        # Fallback: some clients may send single file without 'files' name
        if not files:
            single = request.files.get('file') or request.files.get('upload')
            if single:
                files = [single]

        if not files:
            app.logger.warning('api_upload called with no files; request.files keys: %s', list(request.files.keys()))
            return jsonify({'error': 'no files provided'}), 400

        rows = []
        pending_files = []
        for f in files:
            # Ensure we have a usable filename; if not, generate one
            raw_name = getattr(f, 'filename', '') or ''
            if raw_name:
                filename = secure_filename(raw_name)
            else:
                # try to infer extension from content type
                ext = ''
                if f.content_type:
                    if 'jpeg' in f.content_type:
                        ext = '.jpg'
                    elif 'png' in f.content_type:
                        ext = '.png'
                    elif 'pdf' in f.content_type:
                        ext = '.pdf'
                fd, tmpname = tempfile.mkstemp(suffix=ext, prefix='upload_')
                os.close(fd)
                filename = os.path.basename(tmpname)

            # Save to PENDING folder (not uploads) - file will be moved on approval
            dest = os.path.join(PENDING_FOLDER, filename)
            # Avoid overwriting existing pending files
            base, ext = os.path.splitext(filename)
            counter = 1
            while os.path.exists(dest):
                filename = f"{base}_{counter}{ext}"
                dest = os.path.join(PENDING_FOLDER, filename)
                counter += 1

            try:
                f.save(dest)
                pending_files.append(filename)
                app.logger.info('Saved pending file to %s (size=%s)', dest, os.path.getsize(dest))
            except Exception as e:
                app.logger.exception('Failed to save pending file %s: %s', filename, e)
                rows.append({'Source': 'ERROR', 'Complaint ID': '', 'error': f'failed to save: {e}', 'file': filename})
                continue

            # Process the pending file with extractor
            try:
                result = ncrp.extract_ncrp(dest)
                if result is None:
                    rows.append({'Source': 'ERROR', 'Complaint ID': '', 'error': 'no data extracted', 'file': filename, 'pending_file': filename})
                else:
                    # Normalize result to list of dicts
                    normalized = []
                    if isinstance(result, list):
                        for item in result:
                            if isinstance(item, dict):
                                normalized.append(item)
                            else:
                                normalized.append({'value': item})
                    elif isinstance(result, dict):
                        normalized.append(result)
                    else:
                        normalized.append({'value': result})

                    # Attach the pending filename to each returned row (will be moved on approval)
                    for item in normalized:
                        if isinstance(item, dict):
                            item['pending_file'] = filename
                        rows.append(item)
            except Exception as e:
                app.logger.exception('Extraction failed for %s: %s', filename, e)
                rows.append({'Source': 'ERROR', 'Complaint ID': '', 'error': str(e), 'file': filename, 'pending_file': filename})

        # Always return a JSON body so frontend doesn't get an empty response
        return jsonify({'rows': rows, 'files': pending_files}), 200
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def _save_row_to_sqlite(row):
    """Save a single row dict to SQLite data.db. Returns None on success, raises on error."""
    import sqlite3
    init_sqlite_db()

    col_map = {
        "Source": "source",
        "Complaint ID": "complaint_id",
        "Complaint Date": "complaint_date",
        "Incident Date & Time": "incident_datetime",
        "Mobile": "mobile",
        "Email": "email",
        "Full Address": "full_address",
        "District": "district",
        "State": "state",
        "Cybercrime Type": "cybercrime_type",
        "Platform": "platform",
        "Total Amount Lost": "total_amount_lost",
        "Current Status": "current_status",
    }

    vals = {}
    for df_col, sql_col in col_map.items():
        v = row.get(df_col) or row.get(sql_col)
        vals[sql_col] = v

    # Clean dates
    if vals.get("complaint_date"):
        try:
            dt = pd.to_datetime(vals["complaint_date"], dayfirst=True, errors="coerce")
            vals["complaint_date"] = dt.strftime("%Y-%m-%d") if pd.notna(dt) else None
        except Exception:
            vals["complaint_date"] = str(vals["complaint_date"]) if vals["complaint_date"] else None
    if vals.get("incident_datetime"):
        try:
            dt = pd.to_datetime(vals["incident_datetime"], dayfirst=True, errors="coerce")
            vals["incident_datetime"] = dt.strftime("%Y-%m-%d %H:%M:%S") if pd.notna(dt) else str(vals["incident_datetime"])
        except Exception:
            vals["incident_datetime"] = str(vals["incident_datetime"]) if vals["incident_datetime"] else None

    # Clean amount
    if vals.get("total_amount_lost") is not None and vals.get("total_amount_lost") != "NOT FOUND":
        try:
            s = str(vals["total_amount_lost"]).replace(",", "").replace(" ", "")
            vals["total_amount_lost"] = float(s) if s else None
        except (ValueError, TypeError):
            vals["total_amount_lost"] = None
    else:
        vals["total_amount_lost"] = None

    vals["saved_filename"] = row.get("saved_filename") or row.get("file") or None

    conn = sqlite3.connect(DATA_DB_PATH)
    try:
        conn.execute(
            """
            INSERT INTO """ + DB_TABLE + """ (source, complaint_id, complaint_date, incident_datetime, mobile, email,
                full_address, district, state, cybercrime_type, platform, total_amount_lost, current_status, saved_filename)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                vals.get("source"),
                vals.get("complaint_id"),
                vals.get("complaint_date"),
                vals.get("incident_datetime"),
                vals.get("mobile"),
                vals.get("email"),
                vals.get("full_address"),
                vals.get("district"),
                vals.get("state"),
                vals.get("cybercrime_type"),
                vals.get("platform"),
                vals.get("total_amount_lost"),
                vals.get("current_status"),
                vals.get("saved_filename"),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _move_pending_to_uploads(pending_file, complaint_id):
    """Move a file from pending folder to uploads folder, renaming by complaint_id.
    Returns the final filename in uploads folder, or None if no file to move.
    """
    import json
    if not pending_file:
        return None
    
    src = os.path.join(PENDING_FOLDER, pending_file)
    if not os.path.exists(src):
        app.logger.warning('Pending file not found: %s', src)
        return None
    
    # Determine final filename based on complaint_id
    _, ext = os.path.splitext(pending_file)
    if complaint_id:
        safe_id = secure_filename(str(complaint_id))
        final_name = f"{safe_id}{ext}"
    else:
        final_name = pending_file
    
    dest = os.path.join(UPLOAD_FOLDER, final_name)
    # Avoid overwriting existing files
    counter = 1
    base = final_name.rsplit('.', 1)[0] if '.' in final_name else final_name
    while os.path.exists(dest):
        final_name = f"{base}_{counter}{ext}"
        dest = os.path.join(UPLOAD_FOLDER, final_name)
        counter += 1
    
    try:
        shutil.move(src, dest)
        app.logger.info('Moved pending file %s to uploads as %s', pending_file, final_name)
        
        # Update index mapping
        if complaint_id:
            try:
                idx = {}
                if os.path.exists(INDEX_FILE):
                    with open(INDEX_FILE, 'r', encoding='utf-8') as fh:
                        try:
                            idx = json.load(fh) or {}
                        except Exception:
                            idx = {}
                idx[str(complaint_id)] = final_name
                with open(INDEX_FILE, 'w', encoding='utf-8') as fh:
                    json.dump(idx, fh)
            except Exception:
                app.logger.exception('Failed to update uploads index')
        
        return final_name
    except Exception as e:
        app.logger.exception('Failed to move pending file %s: %s', pending_file, e)
        return None


@app.route('/api/verify', methods=['POST'])
def api_verify():
    """Receive verification decision. If action == 'save', move files from pending to uploads,
    save rows to SQLite (data.db) and Excel.
    Expected JSON: { rows: [...], action: 'save'|'reject' }
    """
    try:
        data = request.get_json()
        if not data or 'action' not in data:
            return jsonify({'error': 'invalid payload'}), 400

        action = data.get('action')
        rows = data.get('rows', [])

        if action == 'reject':
            # Clean up pending files for rejected rows
            for row in rows:
                pending_file = row.get('pending_file')
                if pending_file:
                    try:
                        src = os.path.join(PENDING_FOLDER, pending_file)
                        if os.path.exists(src):
                            os.remove(src)
                            app.logger.info('Deleted rejected pending file: %s', pending_file)
                    except Exception:
                        pass
            return jsonify({'status': 'rejected', 'message': 'Rows rejected by user'}), 200

        if action == 'save':
            if not rows:
                return jsonify({'error': 'no rows to save'}), 400

            init_sqlite_db()
            saved = []
            failed = []
            skipped = []

            for idx, row in enumerate(rows):
                try:
                    # Get complaint ID from the frontend-edited row
                    cid = None
                    if isinstance(row, dict):
                        cid = row.get('Complaint ID') or row.get('complaint_id') or row.get('id') or row.get('ComplaintId')
                    
                    # Check for duplicates in DB
                    if cid:
                        import sqlite3
                        conn = sqlite3.connect(DATA_DB_PATH)
                        try:
                            cur = conn.execute("SELECT 1 FROM {0} WHERE complaint_id = ? LIMIT 1".format(DB_TABLE), (str(cid),))
                            if cur.fetchone():
                                skipped.append({'index': idx, 'row': row, 'reason': 'duplicate complaint_id'})
                                continue
                        finally:
                            conn.close()

                    # Move file from pending to uploads (using the frontend complaint ID)
                    pending_file = row.get('pending_file')
                    final_filename = _move_pending_to_uploads(pending_file, cid)
                    
                    # Update row with final filename for DB storage
                    if final_filename:
                        row['saved_filename'] = final_filename
                    
                    _save_row_to_sqlite(row)
                    saved.append({'index': idx, 'row': row})
                except Exception as e:
                    traceback.print_exc()
                    failed.append({'index': idx, 'row': row, 'error': str(e)})

            excel_info = None
            excel_errors = []
            # Attempt to also append saved rows to an Excel file for record-keeping
            try:
                if saved:
                    # Build DataFrame from saved rows using the canonical columns
                    df_saved = pd.DataFrame([s['row'] for s in saved], columns=ncrp.COLUMNS)
                    excel_path = getattr(ncrp, 'OUTPUT_FILE', 'ncrp_complaints.xlsx')
                    # If file exists, read and concat; otherwise write new
                    if os.path.exists(excel_path):
                        try:
                            df_existing = pd.read_excel(excel_path)
                            df_out = pd.concat([df_existing, df_saved], ignore_index=True)
                            try:
                                df_out.to_excel(excel_path, index=False)
                                excel_info = {'path': excel_path, 'appended_rows': len(df_saved)}
                            except PermissionError:
                                ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
                                alt = f"{os.path.splitext(excel_path)[0]}_{ts}{os.path.splitext(excel_path)[1]}"
                                df_out.to_excel(alt, index=False)
                                excel_info = {'path': alt, 'appended_rows': len(df_saved), 'note': 'primary file locked; wrote to fallback'}
                        except Exception:
                            # If reading existing fails, try simple append by writing a new file with timestamp
                            ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
                            alt = f"{os.path.splitext(excel_path)[0]}_{ts}{os.path.splitext(excel_path)[1]}"
                            df_saved.to_excel(alt, index=False)
                            excel_info = {'path': alt, 'appended_rows': len(df_saved), 'note': 'existing file unreadable; wrote new file'}
                    else:
                        try:
                            df_saved.to_excel(excel_path, index=False)
                            excel_info = {'path': excel_path, 'appended_rows': len(df_saved)}
                        except PermissionError:
                            ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
                            alt = f"{os.path.splitext(excel_path)[0]}_{ts}{os.path.splitext(excel_path)[1]}"
                            df_saved.to_excel(alt, index=False)
                            excel_info = {'path': alt, 'appended_rows': len(df_saved), 'note': 'primary file locked; wrote to fallback'}
            except Exception as e:
                traceback.print_exc()
                excel_errors.append(str(e))

            result = {'saved_count': len(saved), 'failed_count': len(failed), 'failed': failed, 'skipped_count': len(skipped), 'skipped': skipped, 'excel': excel_info, 'excel_errors': excel_errors}
            # Return 200 even if some rows failed; frontend will display details
            return jsonify(result), 200

        return jsonify({'error': 'unknown action'}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/complaints', methods=['GET'])
def api_complaints():
    """Fetch complaints from SQLite data.db and return as JSON.
    """
    try:
        init_sqlite_db()
        import sqlite3
        conn = sqlite3.connect(DATA_DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.execute("SELECT * FROM {0} ORDER BY id DESC LIMIT 1000".format(DB_TABLE))
        rows = [dict(row) for row in cur.fetchall()]
        conn.close()

        # Convert SQL column names to frontend-friendly names
        mapped = []
        # load index mapping if present
        index_map = {}
        try:
            import json
            if os.path.exists(INDEX_FILE):
                with open(INDEX_FILE, 'r', encoding='utf-8') as fh:
                    index_map = json.load(fh) or {}
        except Exception:
            index_map = {}
        for r in rows:
            mapped.append({
                'id': r.get('complaint_id') or r.get('complaint_id'),
                'complaintDate': r.get('complaint_date'),
                'incidentDateTime': r.get('incident_datetime'),
                'mobileNumber': r.get('mobile'),
                'emailId': r.get('email'),
                'fullAddress': r.get('full_address'),
                'districtState': (r.get('district') or '') + (', ' + (r.get('state') or '') if r.get('state') else ''),
                'cybercrimeType': r.get('cybercrime_type'),
                'platformInvolved': r.get('platform'),
                'totalAmountLoss': str(r.get('total_amount_lost')) if r.get('total_amount_lost') is not None else None,
                'currentStatus': r.get('current_status'),
                'processedDateTime': r.get('created_at'),
                # include any saved filename / source file info if available in DB
                'savedFilename': r.get('saved_filename') or r.get('file') or index_map.get(str(r.get('complaint_id'))) or None
            })

        return jsonify({'rows': mapped})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/config', methods=['GET'])
def api_config():
    """Return simple runtime config for frontend (API base URL)."""
    api_base = os.environ.get('API_BASE_URL', 'http://localhost:5000')
    # Also expose the uploads route base name (frontend may construct file URLs using this)
    uploads_route = os.environ.get('UPLOADS_ROUTE', '/uploads')
    return jsonify({'API_BASE': api_base, 'UPLOADS_ROUTE': uploads_route})


@app.route('/uploads/<path:filename>', methods=['GET'])
def serve_upload(filename):
    """Serve uploaded files from the uploads folder."""
    try:
        return send_from_directory(UPLOAD_FOLDER, filename, as_attachment=False)
    except Exception as e:
        app.logger.exception('Failed to serve upload %s: %s', filename, e)
        return jsonify({'error': 'file not found'}), 404


OLLAMA_MODEL = "huggingface.co/QuantFactory/Meta-Llama-3-8B-Instruct-GGUF:latest"
#OLLAMA_MODEL = "llama3"


def ask_llm(prompt: str) -> str:
    """Call Ollama safely and return text"""
    try:
        process = subprocess.run(
            ["ollama", "run", OLLAMA_MODEL],
            input=prompt,
            text=True,
            encoding="utf-8",
            errors="ignore",
            capture_output=True,
            timeout=120
        )
        return process.stdout.strip()

    except Exception as e:
        return f"LLM Error: {e}"


def build_prompt(data: dict) -> str:
    return f"""
You are an Indian cybercrime investigation assistant.

Complaint Details:
Cybercrime Type: {data.get("Cybercrime Type")}
Platform: {data.get("Platform")}
Amount Lost: ₹{data.get("Total Amount Lost")}
State: {data.get("State")}
District: {data.get("District")}

TASK:
Explain the risk briefly and suggest mitigation measures.

RULES:
- Answer in bullet points
- Max 80 words
- i should not get this line "Here is a brief explanation of the risk and suggested mitigation measures:" and this one Let me know if you'd like me to improve anything!
""" 

@app.route("/api/input", methods=["GET"])
def get_input_format():
    sample_data = {
        "Cybercrime Type": "UPI Fraud",
        "Platform": "PhonePe",
        "Total Amount Lost": 15000,
        "State": "Tamil Nadu",
        "District": "Chennai"
    }

    prompt = build_prompt(sample_data)
    response = ask_llm(prompt)  

    return jsonify({
        "status": "success",
        "mitigation_measures": response
    })


@app.route("/api/mitigation", methods=["POST"])
def generate_mitigation():
    data = request.json

    if not data:
        return jsonify({"error": "No JSON data received"}), 400

    prompt = build_prompt(data)
    response = ask_llm(prompt)

    return jsonify({
        "status": "success",
        "mitigation_measures": response
    })


if __name__ == '__main__':
    print('Using SQLite database:', DATA_DB_PATH)
    app.run(host='0.0.0.0', port=5000, debug=True)
