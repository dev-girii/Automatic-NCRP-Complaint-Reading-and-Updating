# Automated NCRP Complaint Reading and Updating Tool

A hackathon project featuring a pure frontend web application for managing NCRP complaints.

## Features

- User login with username and password
- Dashboard for managing NCRP complaints
- Drag & drop file upload (CSV, XLSX, PDF)
- Duplicate detection and processing
- Analytics with interactive charts
- Cyber crime awareness panel
- Responsive design with government-style UI

## Setup Instructions

### Prerequisites

- Modern web browser
- Local web server (optional, for better functionality)

### Running the Application

1. **Simple Method (Recommended):**
   Open `index.html` directly in your web browser by double-clicking the file.

2. **Advanced Method (Better for file uploads):**
   Use a local web server:
   ```bash
   python -m http.server 8000
   ```
   Then open http://localhost:8000 in your browser.

## Usage

1. **Login:**
   - Username: `admin`
   - Password: `admin123`

2. **Dashboard Features:**
   - Drag & drop or click to upload CSV, XLSX, or PDF files
   - View real-time statistics (Total Complaints, New Entries, Duplicates, First Priority Cases)
   - Cyber crime awareness panel with risk categories
   - Process files to extract and analyze complaint data

3. **Navigation:**
   - Dashboard: File upload and statistics
   - Complaints: View detailed complaint records
   - Analytics: Interactive charts and visualizations

## File Processing

- **Supported Formats:** CSV, XLSX, PDF
- **Duplicate Detection:** Automatic identification of duplicate complaint IDs
- **First Priority Cases:** Automatic flagging of severe cases (Hacking, Identity Theft)
- **Statistics Updates:** Real-time counter updates with animations

## Security Notes

- All data processing happens locally in the browser
- No data is sent to external servers
- Educational and demonstration purposes only
- No real NCRP data access or government integration