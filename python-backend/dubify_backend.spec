# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[
        # Include static binaries like ffmpeg if they are in bin/
        ('bin', 'bin'),
    ],
    hiddenimports=[
        'fastapi',
        'uvicorn',
        'websockets',
        'google.genai',
        'edge_tts',
        'yt_dlp',
        'whisper',
        'whisper.normalizers',
        'whisper.decoding',
        'demucs',
        'demucs.separate',
        'demucs.models',
        'demucs.apply',
        'demucs.audio',
        'demucs.htdemucs',
        'pydantic',
        'cryptography',
        'torch',
        'torchaudio',
        'scipy',
        'scipy.signal',
        'soundfile',
        'tqdm',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='main',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='main',
)
