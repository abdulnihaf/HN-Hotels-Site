import os
import subprocess
import sys

# Maximum file size in bytes (5MB)
MAX_SIZE_BYTES = 5 * 1024 * 1024

def get_staged_media_files():
    """Returns a list of staged files in media/wa/ specific folders."""
    try:
        # Get list of staged files
        result = subprocess.run(
            ['git', 'diff', '--cached', '--name-only'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True
        )
        files = result.stdout.strip().split('\n')
        
        # Filter for images in the target directories
        target_dirs = ['media/wa/he', 'media/wa/hh', 'media/wa/hn', 'media/wa/nch']
        media_files = []
        for f in files:
            if not f: continue
            # Check extensions
            if f.lower().endswith(('.png', '.jpg', '.jpeg')):
                # Check path prefix
                for d in target_dirs:
                    if f.startswith(d):
                        media_files.append(f)
                        break
        return media_files
    except subprocess.CalledProcessError as e:
        print(f"Error getting staged files: {e.stderr}")
        return []

def compress_image(filepath):
    """Compresses the image using sips until it is under MAX_SIZE_BYTES."""
    if not os.path.exists(filepath):
        return

    original_size = os.path.getsize(filepath)
    if original_size <= MAX_SIZE_BYTES:
        return

    print(f"Compressing {filepath} ({original_size/1024/1024:.2f} MB)...")

    # Determine file type
    is_png = filepath.lower().endswith('.png')
    
    # Process for reducing size
    # 1. First Pass: If it's a huge PNG, maybe convert to JPG? Or just resize? 
    # The user said "without loosing clarity". Changing format is risky for transparency.
    # We will stick to resizing/resampling.

    current_size = original_size
    
    # We will loop to reduce dimensions if simple quality tweak isn't enough (for jpg)
    # sips -Z <pixels> preserves aspect ratio and sets max width/height
    
    # Get current dimensions
    try:
        dim_out = subprocess.check_output(['sips', '-g', 'pixelWidth', filepath], text=True)
        current_width_str = dim_out.strip().split(':')[-1].strip()
        current_width = int(current_width_str)
    except Exception as e:
        print(f"Error reading dimensions: {e}")
        return

    scale_factor = 0.9 # Reduce by 10% each time
    
    while current_size > MAX_SIZE_BYTES:
        new_width = int(current_width * scale_factor)
        
        # Avoid making it too small (sanity check)
        if new_width < 500:
             print(f"Warning: Could not compress {filepath} below 5MB without making it too small.")
             break
             
        # Run sips to resample
        # For JPEG we can also adjust quality, but sips --resampleWidth is robust for size
        # If it is JPEG, we can try setting formatOptions 'low' or percentage first?
        # Let's just resize for simplicity and universality across png/jpg for now as file size depends heavily on resolution.
        
        subprocess.run(
            ['sips', '--resampleWidth', str(new_width), filepath],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True
        )
        
        current_size = os.path.getsize(filepath)
        current_width = new_width
        print(f"  New size: {current_size/1024/1024:.2f} MB (Width: {current_width}px)")
        
        if current_size <= MAX_SIZE_BYTES:
            print(f"  Success: {filepath} is now under 5MB.")
            # Re-stage the file
            subprocess.run(['git', 'add', filepath], check=True)
            break
            
        scale_factor = 0.9 # Keep reducing if not enough

def main():
    staged_files = get_staged_media_files()
    if not staged_files:
        return

    for f in staged_files:
        compress_image(f)

if __name__ == "__main__":
    main()
