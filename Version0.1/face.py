import cv2
import os
import tkinter as tk
from tkinter import messagebox
from PIL import Image, ImageTk
from mtcnn import MTCNN

# ตั้งค่า TensorFlow
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

class FaceCaptureGUI:
    def __init__(self, window):
        self.window = window
        self.window.title("ระบบบันทึกใบหน้า - Check-in System")
        self.window.geometry("800x650")

        # ตัวแปรควบคุม
        self.detector = MTCNN()
        self.cap = None
        self.is_capturing = False
        self.count = 0
        self.max_samples = 200
        self.img_size = (160, 160)

        # --- ส่วนของ GUI ---
        tk.Label(window, text="ชื่อผูู้ใช้งาน (English only):", font=("Arial", 12)).pack(pady=5)
        self.name_entry = tk.Entry(window, font=("Arial", 12), width=30)
        self.name_entry.pack(pady=5)

        self.btn_frame = tk.Frame(window)
        self.btn_frame.pack(pady=10)

        self.start_btn = tk.Button(self.btn_frame, text="เริ่มบันทึกหน้า", command=self.start_capture, 
                                   bg="#4CAF50", fg="white", font=("Arial", 10, "bold"), width=15)
        self.start_btn.grid(row=0, column=0, padx=5)

        self.stop_btn = tk.Button(self.btn_frame, text="หยุด/ยกเลิก", command=self.stop_capture, 
                                  bg="#f44336", fg="white", font=("Arial", 10, "bold"), width=15)
        self.stop_btn.grid(row=0, column=1, padx=5)

        self.status_label = tk.Label(window, text="สถานะ: พร้อมใช้งาน", font=("Arial", 10), fg="blue")
        self.status_label.pack()

        # ส่วนแสดงภาพจากกล้อง
        self.video_label = tk.Label(window, bg="black")
        self.video_label.pack(pady=10)

    def start_capture(self):
        name = self.name_entry.get().strip()
        if not name:
            messagebox.showwarning("คำเตือน", "กรุณาใส่ชื่อก่อนเริ่มบันทึกครับ")
            return

        self.output_dir = f'dataset_raw/{name}'
        if not os.path.exists(self.output_dir):
            os.makedirs(self.output_dir)

        self.is_capturing = True
        self.count = 0
        self.start_btn.config(state=tk.DISABLED)
        self.name_entry.config(state=tk.DISABLED)
        
        if self.cap is None:
            self.cap = cv2.VideoCapture(0)
        
        self.update_frame()

    def stop_capture(self):
        self.is_capturing = False
        if self.cap:
            self.cap.release()
            self.cap = None
        self.video_label.config(image='')
        self.start_btn.config(state=tk.NORMAL)
        self.name_entry.config(state=tk.NORMAL)
        self.status_label.config(text="สถานะ: หยุดการทำงาน", fg="red")

    def update_frame(self):
        if self.is_capturing:
            ret, frame = self.cap.read()
            if ret:
                # ประมวลผลภาพ
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = self.detector.detect_faces(rgb_frame)

                if results and self.count < self.max_samples:
                    x, y, w, h = [abs(v) for v in results[0]['box']]
                    
                    face = rgb_frame[y:y+h, x:x+w]
                    if face.size != 0:
                        self.count += 1
                        face_resized = cv2.resize(face, self.img_size)
                        face_final = cv2.cvtColor(face_resized, cv2.COLOR_RGB2BGR)
                        
                        file_path = os.path.join(self.output_dir, f"{self.count}.jpg")
                        cv2.imwrite(file_path, face_final)

                        # วาดกรอบโชว์บนจอ
                        cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 255, 0), 2)
                
                # อัปเดต UI
                self.status_label.config(text=f"กำลังบันทึก: {self.count} / {self.max_samples} รูป", fg="green")
                
                # แปลงภาพไปแสดงบน Tkinter
                img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                imgtk = ImageTk.PhotoImage(image=img)
                self.video_label.imgtk = imgtk
                self.video_label.configure(image=imgtk)

                if self.count >= self.max_samples:
                    self.stop_capture()
                    messagebox.showinfo("สำเร็จ", f"บันทึกใบหน้าของ {self.name_entry.get()} ครบ 200 รูปแล้ว!")
                else:
                    self.window.after(10, self.update_frame)

# รันโปรแกรม
if __name__ == "__main__":
    root = tk.Tk()
    app = FaceCaptureGUI(root)
    root.mainloop()