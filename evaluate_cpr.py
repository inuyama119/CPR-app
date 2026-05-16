import cv2
import numpy as np
import os
import glob
import math
import urllib.request

# Download model if not exists
model_path = 'pose_landmarker_full.task'
if not os.path.exists(model_path):
    print("Downloading model...")
    urllib.request.urlretrieve('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task', model_path)
    print("Download complete.")

import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

base_options = python.BaseOptions(model_asset_path=model_path)
options = vision.PoseLandmarkerOptions(
    base_options=base_options,
    output_segmentation_masks=False,
    min_pose_detection_confidence=0.3,
    min_pose_presence_confidence=0.3,
    min_tracking_confidence=0.3)
detector = vision.PoseLandmarker.create_from_options(options)

def calculate_angle_3d(a, b, c):
    v1 = np.array([a.x - b.x, a.y - b.y, a.z - b.z])
    v2 = np.array([c.x - b.x, c.y - b.y, c.z - b.z])
    mag1 = np.linalg.norm(v1)
    mag2 = np.linalg.norm(v2)
    if mag1 == 0 or mag2 == 0: return 0
    cos_val = np.dot(v1, v2) / (mag1 * mag2)
    return np.degrees(np.arccos(np.clip(cos_val, -1.0, 1.0)))

def process_video(video_path, sensitivity_cm=3.0):
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps == 0 or math.isnan(fps): fps = 30.0
    
    frame_count = 0
    history = []
    
    is_down = False
    compressions = 0
    last_comp_time = 0
    
    total_frames = 0
    good_posture_frames = 0
    all_angles = []
    depths = []
    
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret: break
        
        timestamp_ms = int((frame_count / fps) * 1000)
        frame_count += 1
        total_frames += 1
        
        image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)
        
        try:
            # Using detect instead of detect_for_video for simplicity in offline batch analysis
            detection_result = detector.detect(mp_image)
        except Exception as e:
            continue
            
        if not detection_result.pose_landmarks:
            continue
            
        landmarks = detection_result.pose_landmarks[0]
        
        # --- 1. Posture Angle ---
        vis_l = landmarks[13].visibility
        vis_r = landmarks[14].visibility
        left_angle = calculate_angle_3d(landmarks[11], landmarks[13], landmarks[15])
        right_angle = calculate_angle_3d(landmarks[12], landmarks[14], landmarks[16])
        
        raw_angle = left_angle if vis_l > vis_r else right_angle
        all_angles.append(raw_angle)
        
        is_angle_good = raw_angle > 115
        
        shoulder_x = (landmarks[11].x + landmarks[12].x) / 2
        wrist_x = landmarks[15].x if vis_l > vis_r else landmarks[16].x
        nose_x = landmarks[0].x
        is_facing_right = nose_x > shoulder_x
        diff_x = shoulder_x - wrist_x
        normalized_tilt = diff_x if is_facing_right else -diff_x
        is_vertical = -0.15 < normalized_tilt < 0.15 
        
        if is_angle_good and is_vertical:
            good_posture_frames += 1
        
        # --- 2. Count Logic (VRM) ---
        current_shoulder_y = (landmarks[11].y + landmarks[12].y + landmarks[0].y) / 3
        current_hip_y = (landmarks[23].y + landmarks[24].y) / 2
        current_torso_px = abs(current_shoulder_y - current_hip_y)
        if current_torso_px == 0: current_torso_px = 0.1
        
        history.append({'t': timestamp_ms, 'y': current_shoulder_y, 'torso': current_torso_px})
        if len(history) > 60:
            history.pop(0)
            
        if len(history) > 15:
            ys = [h['y'] for h in history]
            torsos = [h['torso'] for h in history]
            
            pixel_range = max(ys) - min(ys)
            avg_torso = sum(torsos) / len(torsos)
            
            current_depth_cm = (pixel_range / avg_torso) * 48.0
            depths.append(current_depth_cm)
            mid_y = (max(ys) + min(ys)) / 2
            
            if current_depth_cm > sensitivity_cm:
                if not is_down and current_shoulder_y > mid_y + (pixel_range * 0.1):
                    is_down = True
                elif is_down and current_shoulder_y < mid_y - (pixel_range * 0.1):
                    time_since_last = timestamp_ms - last_comp_time
                    is_down = False
                    if last_comp_time == 0 or time_since_last > 300:
                        compressions += 1
                        last_comp_time = timestamp_ms

    cap.release()
    
    avg_a = sum(all_angles)/len(all_angles) if all_angles else 0
    max_d = max(depths) if depths else 0
    posture_rate = (good_posture_frames / total_frames * 100) if total_frames > 0 else 0
    
    return {
        'compressions': compressions,
        'avg_angle': avg_a,
        'posture_rate': posture_rate,
        'max_depth': max_d
    }

print("=== AI Accuracy Evaluation Started ===")

folders = ["測定用ビデオ半袖", "測定用ビデオ長袖"]
for folder in folders:
    print(f"\n--- {folder} ---")
    files = glob.glob(f"{folder}/*.mov")
    for f in files:
        fname = os.path.basename(f)
        try:
            res = process_video(f)
            print(f"[{fname}] Count: {res['compressions']}/30 | Avg Angle: {res['avg_angle']:.1f}° | Posture OK: {res['posture_rate']:.1f}% | Max Depth: {res['max_depth']:.1f}cm")
        except Exception as e:
            print(f"[{fname}] Error: {str(e)}")

print("\n=== Evaluation Complete ===")
