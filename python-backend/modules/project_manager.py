import os
import json
import zipfile
import shutil
import logging
from datetime import datetime

logger = logging.getLogger("dubify.project_manager")

def save_project(workspace_dir, output_zip_path):
    """
    Saves the project workspace by zipping the contents.
    Creates a zip archive and renames it to output_zip_path (usually ends in .dubify).
    """
    logger.info(f"Saving project from {workspace_dir} to {output_zip_path}...")
    
    # Update last_modified in project.json before zipping
    project_json_path = os.path.join(workspace_dir, "project.json")
    if os.path.exists(project_json_path):
        try:
            with open(project_json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            data["last_modified"] = datetime.utcnow().isoformat() + "Z"
            
            with open(project_json_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to update project.json timestamp: {e}")
            
    # Ensure parent directory of output exists
    os.makedirs(os.path.dirname(os.path.abspath(output_zip_path)), exist_ok=True)
    
    # Create zip file
    try:
        # We write to a temporary file first, then move it, to avoid half-written files
        temp_zip = output_zip_path + ".tmp"
        with zipfile.ZipFile(temp_zip, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for root, dirs, files in os.walk(workspace_dir):
                for file in files:
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, workspace_dir)
                    # Don't bundle other temp files if any
                    if rel_path.endswith('.tmp'):
                        continue
                    zip_file.write(full_path, rel_path)
                    
        if os.path.exists(output_zip_path):
            os.remove(output_zip_path)
        os.rename(temp_zip, output_zip_path)
        logger.info(f"Project saved successfully.")
        return True
    except Exception as e:
        logger.error(f"Failed to save project: {e}")
        if os.path.exists(temp_zip):
            os.remove(temp_zip)
        raise e

def load_project(zip_path, workspace_dir):
    """
    Loads a .dubify project by unzipping it into workspace_dir.
    Clears workspace_dir before extracting.
    """
    logger.info(f"Loading project from {zip_path} to {workspace_dir}...")
    
    if not os.path.exists(zip_path):
        raise FileNotFoundError(f"Project file not found: {zip_path}")
        
    try:
        # Clear workspace directory first
        if os.path.exists(workspace_dir):
            shutil.rmtree(workspace_dir)
        os.makedirs(workspace_dir, exist_ok=True)
        
        # Unzip
        with zipfile.ZipFile(zip_path, 'r') as zip_file:
            zip_file.extractall(workspace_dir)
            
        # Verify project.json exists
        project_json_path = os.path.join(workspace_dir, "project.json")
        if not os.path.exists(project_json_path):
            raise ValueError("Invalid .dubify file: project.json is missing.")
            
        with open(project_json_path, 'r', encoding='utf-8') as f:
            project_data = json.load(f)
            
        logger.info(f"Project loaded successfully. Video: {project_data.get('video_path')}")
        return project_data
    except Exception as e:
        logger.error(f"Failed to load project: {e}")
        raise e
