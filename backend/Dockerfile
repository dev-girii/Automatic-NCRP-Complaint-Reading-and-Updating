# Dockerfile for deploying the backend on Render (or any Docker-based host)
# Installs tesseract-ocr and Python dependencies, exposes port 5000 and runs with gunicorn

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install system packages required for tesseract and general utilities
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       tesseract-ocr \
       libtesseract-dev \
       libleptonica-dev \
       pkg-config \
       poppler-utils \
       ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python deps
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend sources
COPY . /app

# Expose port used by Flask/Gunicorn
EXPOSE 5000

# Set default TESSERACT_CMD env (optional — shutil.which will also find it)
ENV TESSERACT_CMD=/usr/bin/tesseract

# Run the Flask app using gunicorn
# Ensure the working directory contains app.py with a Flask `app` object
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app", "--workers", "4"]
