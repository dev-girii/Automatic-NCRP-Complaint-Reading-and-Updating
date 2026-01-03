from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
from werkzeug.utils import secure_filename
import tempfile
import traceback
import datetime

app = Flask(__name__)
CORS(app)

# Ensure backend path imports the script
import ncrp_script as ncrp
import pandas as pd

# Upload folder
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
INDEX_FILE = os.path.join(UPLOAD_FOLDER, 'file_index.json')


@app.route('/api/upload', methods=['POST'])
def api_upload():
    """Accept multipart/form-data files under 'files' and process them with existing extractor.
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
        saved_files = []
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

            dest = os.path.join(UPLOAD_FOLDER, filename)
            try:
                f.save(dest)
                saved_files.append(filename)
                app.logger.info('Saved uploaded file to %s (size=%s)', dest, os.path.getsize(dest))
            except Exception as e:
                app.logger.exception('Failed to save uploaded file %s: %s', filename, e)
                rows.append({'Source': 'ERROR', 'Complaint ID': '', 'error': f'failed to save: {e}', 'file': filename})
                continue

            # Process the saved file with extractor. Ensure extractor return is normalized to a dict/object
            try:
                result = ncrp.extract_ncrp(dest)
                if result is None:
                    rows.append({'Source': 'ERROR', 'Complaint ID': '', 'error': 'no data extracted', 'file': filename})
                else:
                    # Attempt to determine complaint id from the extractor result so we can rename the file
                    deduced_id = None
                    def _extract_id_from_row(r):
                        if not r: return None
                        for key in ('Complaint ID','complaint_id','id','ComplaintId'):
                            if isinstance(r, dict) and key in r and r[key]:
                                return str(r[key])
                        return None

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

                    # Try to pick first available complaint id
                    for r_item in normalized:
                        candidate = _extract_id_from_row(r_item)
                        if candidate:
                            deduced_id = candidate
                            break

                    # If we have an id, rename the saved file to <id>.<ext> for easy mapping
                    new_filename = filename
                    try:
                        if deduced_id:
                            # Clean id to safe filename chars
                            safe_id = secure_filename(deduced_id)
                            _, ext = os.path.splitext(filename)
                            if not ext:
                                # guess from content-type
                                ext = ''
                            candidate_name = f"{safe_id}{ext}"
                            candidate_path = os.path.join(UPLOAD_FOLDER, candidate_name)
                            # avoid overwriting existing - add suffix if needed
                            suffix = 1
                            base_candidate = candidate_name
                            while os.path.exists(candidate_path):
                                candidate_name = f"{safe_id}_{suffix}{ext}"
                                candidate_path = os.path.join(UPLOAD_FOLDER, candidate_name)
                                suffix += 1
                            # perform rename
                            os.rename(dest, candidate_path)
                            new_filename = candidate_name
                            dest = candidate_path
                            app.logger.info('Renamed uploaded file to %s', new_filename)
                            # update saved_files list entry if present
                            try:
                                saved_files[-1] = new_filename
                            except Exception:
                                pass
                            # update index mapping file so complaints can be linked later
                            try:
                                import json
                                idx = {}
                                if os.path.exists(INDEX_FILE):
                                    with open(INDEX_FILE, 'r', encoding='utf-8') as fh:
                                        try:
                                            idx = json.load(fh) or {}
                                        except Exception:
                                            idx = {}
                                idx[str(safe_id)] = new_filename
                                with open(INDEX_FILE, 'w', encoding='utf-8') as fh:
                                    json.dump(idx, fh)
                            except Exception:
                                app.logger.exception('Failed to update uploads index')
                    except Exception:
                        app.logger.exception('Failed to rename uploaded file %s', filename)

                    # Attach the saved filename to each returned row so frontend can build the file link
                    for item in normalized:
                        if isinstance(item, dict):
                            item['saved_filename'] = new_filename
                        rows.append(item)
            except Exception as e:
                app.logger.exception('Extraction failed for %s: %s', filename, e)
                rows.append({'Source': 'ERROR', 'Complaint ID': '', 'error': str(e), 'file': filename})

        # Always return a JSON body so frontend doesn't get an empty response
        return jsonify({'rows': rows, 'files': saved_files}), 200
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/verify', methods=['POST'])
def api_verify():
    """Receive verification decision. If action == 'save', save rows to MySQL (and optionally Sheets).
    Expected JSON: { rows: [...], action: 'save'|'reject' }
    """
    try:
        data = request.get_json()
        if not data or 'action' not in data:
            return jsonify({'error': 'invalid payload'}), 400

        action = data.get('action')
        rows = data.get('rows', [])

        if action == 'reject':
            return jsonify({'status': 'rejected', 'message': 'Rows rejected by user'}), 200

        if action == 'save':
            if not rows:
                return jsonify({'error': 'no rows to save'}), 400

            # Read DB credentials from env
            db_user = os.environ.get('DB_USER')
            db_password = os.environ.get('DB_PASSWORD', '')
            db_host = os.environ.get('DB_HOST', 'localhost')
            db_port = int(os.environ.get('DB_PORT', 3306))
            db_name = os.environ.get('DB_NAME', 'ncrp_db')
            db_table = os.environ.get('DB_TABLE', 'ncrp_complaints')

            if not db_user:
                return jsonify({'error': 'DB_USER not configured on server'}), 500

            saved = []
            failed = []
            skipped = []

            # Create an engine for duplicate checks (we'll still use ncrp.save_df_to_mysql for insertion to keep cleaning logic)
            from sqlalchemy import create_engine, text
            engine = create_engine(f"mysql+pymysql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}?charset=utf8mb4")

            # Save rows one-by-one to provide per-row feedback, but check duplicates first
            for idx, row in enumerate(rows):
                try:
                    # Determine complaint id (if any) for duplicate detection
                    cid = None
                    if isinstance(row, dict):
                        cid = row.get('Complaint ID') or row.get('complaint_id') or row.get('id') or row.get('ComplaintId')
                    if cid:
                        # check DB for existing complaint_id
                        try:
                            q = text(f"SELECT 1 FROM {db_table} WHERE complaint_id = :cid LIMIT 1")
                            with engine.connect() as conn:
                                res = conn.execute(q, {'cid': str(cid)}).fetchone()
                                if res:
                                    # duplicate found -> skip
                                    skipped.append({'index': idx, 'row': row, 'reason': 'duplicate complaint_id'})
                                    continue
                        except Exception:
                            # if duplicate check fails for any reason, log and proceed to attempt save
                            app.logger.exception('Duplicate check failed for complaint_id %s', cid)

                    # Build single-row DataFrame using ncrp.COLUMNS to ensure consistent columns
                    df_row = pd.DataFrame([row], columns=ncrp.COLUMNS)
                    ncrp.save_df_to_mysql(df_row, user=db_user, password=db_password, host=db_host, port=db_port, db=db_name, table=db_table)
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
    """Fetch complaints from the configured MySQL DB and return as JSON.
    """
    try:
        db_user = os.environ.get('DB_USER')
        db_password = os.environ.get('DB_PASSWORD', '')
        db_host = os.environ.get('DB_HOST', 'localhost')
        db_port = int(os.environ.get('DB_PORT', 3306))
        db_name = os.environ.get('DB_NAME', 'ncrp_db')
        db_table = os.environ.get('DB_TABLE', 'ncrp_complaints')

        if not db_user:
            return jsonify({'error': 'DB_USER not configured on server'}), 500

        from sqlalchemy import create_engine, text
        engine = create_engine(f"mysql+pymysql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}?charset=utf8mb4")
        q = text(f"SELECT * FROM {db_table} ORDER BY id DESC LIMIT 1000")
        with engine.connect() as conn:
            res = conn.execute(q)
            cols = res.keys()
            rows = [dict(zip(cols, row)) for row in res.fetchall()]

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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
