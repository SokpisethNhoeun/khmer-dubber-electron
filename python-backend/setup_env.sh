#!/bin/bash
set -e

echo "Setting up Python backend environment..."
cd "$(dirname "$0")"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

echo "Upgrading pip..."
pip install --upgrade pip

# Detect CUDA
HAS_CUDA=false
if command -v nvidia-smi &> /dev/null; then
    echo "NVIDIA GPU detected. Installing PyTorch with CUDA support..."
    pip install torch torchaudio --extra-index-url https://download.pytorch.org/whl/cu121
    HAS_CUDA=true
else
    echo "No NVIDIA GPU detected. Installing PyTorch CPU version..."
    pip install torch torchaudio --extra-index-url https://download.pytorch.org/whl/cpu
fi

echo "Installing remaining requirements..."
pip install -r requirements.txt

echo "Setup complete! Virtual environment is ready."
if [ "$HAS_CUDA" = true ]; then
    python -c "import torch; print('CUDA available in PyTorch:', torch.cuda.is_available())"
fi
