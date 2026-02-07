Tesseract OCR - Bundled with NCRP Complaint Tool
================================================

This folder should contain the Tesseract OCR executable and data files.

RUN setup-tesseract.bat FROM THE FRONTEND FOLDER to copy Tesseract here.

Expected structure after setup:
  tools/tesseract/
    tesseract.exe
    tessdata/
      eng.traineddata
    (and any required DLLs)

If you already have Tesseract installed, the setup script will copy it.
Otherwise, download and install from:
  https://github.com/UB-Mannheim/tesseract/wiki

Default install path: C:\Program Files\Tesseract-OCR\
