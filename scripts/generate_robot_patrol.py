import os
import time
import cv2
import numpy as np
from PIL import Image

def main():
    start_time = time.time()
    video_path = 'robot.mp4'
    bg_path = 'estimated_bg.png'
    out_dir = os.path.join('pratyaksha-extension', 'assets')
    os.makedirs(out_dir, exist_ok=True)
    
    webp_path = os.path.join(out_dir, 'robot-patrol.webp')
    gif_path = os.path.join(out_dir, 'robot-patrol.gif')
    
    print(f"Loading background model: {bg_path}...")
    bg = cv2.imread(bg_path)
    if bg is None:
        raise FileNotFoundError(f"Cannot load background image {bg_path}")
        
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise FileNotFoundError(f"Cannot open video file {video_path}")
        
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    print(f"Source video has {total_frames} frames at {fps:.1f} fps.")
    
    kernel_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    frames_rgba = []
    
    # Process all frames for butter-smooth animation
    # Crop bounds: y from 160 to 540, x from 80 to 1200
    # Resized to 560x190
    for idx in range(total_frames):
        ret, frame = cap.read()
        if not ret:
            break
            
        diff = np.linalg.norm(frame.astype(np.float32) - bg.astype(np.float32), axis=2)
        binary = (diff > 10.0).astype(np.uint8) * 255
        
        # Suppress ground studio shadow below y=545
        binary[545:, :] = 0
        
        # Morphological closing to bridge head ridge and details
        closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel_close)
        
        # Extract solid external contours
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        mask = np.zeros(closed.shape, dtype=np.uint8)
        for cnt in contours:
            if cv2.contourArea(cnt) > 200:
                cv2.drawContours(mask, [cnt], -1, 255, thickness=cv2.FILLED)
                
        # Fill any internal pinholes
        h, w = mask.shape
        mask_flood = mask.copy()
        mask_flood_inv = np.zeros((h + 2, w + 2), np.uint8)
        cv2.floodFill(mask_flood, mask_flood_inv, (0, 0), 255)
        mask_solid = mask | cv2.bitwise_not(mask_flood)
        
        # Anti-aliased alpha boundary
        mask_blur = cv2.GaussianBlur(mask_solid, (3, 3), 0.75)
        
        rgba = cv2.cvtColor(frame, cv2.COLOR_BGR2BGRA)
        rgba[:, :, 3] = mask_blur
        
        # Crop to horizontal flight corridor
        cropped = rgba[160:540, 80:1200]
        resized = cv2.resize(cropped, (560, 190), interpolation=cv2.INTER_AREA)
        
        rgba_pil = cv2.cvtColor(resized, cv2.COLOR_BGRA2RGBA)
        frames_rgba.append(Image.fromarray(rgba_pil))
        
        if (idx + 1) % 60 == 0 or idx == total_frames - 1:
            print(f"Processed frame {idx + 1}/{total_frames}...")

    cap.release()
    print(f"All {len(frames_rgba)} frames segmented in {time.time() - start_time:.2f}s.")
    
    # Save animated WebP with full 32-bit RGBA channel
    print("Writing WebP animation...")
    webp_start = time.time()
    frames_rgba[0].save(
        webp_path,
        save_all=True,
        append_images=frames_rgba[1:],
        duration=int(1000.0 / fps),
        loop=0,
        quality=90,
        method=4
    )
    print(f"Saved {webp_path} ({os.path.getsize(webp_path):,} bytes) in {time.time() - webp_start:.2f}s.")
    
    # Save animated GIF
    print("Writing GIF animation...")
    gif_start = time.time()
    gif_frames = [f.convert('RGBA') for f in frames_rgba]
    gif_frames[0].save(
        gif_path,
        save_all=True,
        append_images=gif_frames[1:],
        duration=int(1000.0 / fps),
        loop=0,
        disposal=2
    )
    print(f"Saved {gif_path} ({os.path.getsize(gif_path):,} bytes) in {time.time() - gif_start:.2f}s.")
    print("Complete!")

if __name__ == '__main__':
    main()
