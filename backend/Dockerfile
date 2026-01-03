FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
       tesseract-ocr \
       libtesseract-dev \
       libleptonica-dev \
       pkg-config \
       poppler-utils \
       ffmpeg \
       libgl1 \
       libglib2.0-0 \
       build-essential \
       cmake \
       wget \
       git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python deps
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend sources
COPY . /app

# Expose port used by Flask/Gunicorn
EXPOSE 5000

# Set default TESSERACT_CMD env (optional)
ENV TESSERACT_CMD=/usr/bin/tesseract

# Run the Flask app using gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app", "--workers", "4"]
