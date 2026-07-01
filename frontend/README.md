# 🛡️ Admin Features - Attendance System

Welcome to the Admin module of the Attendance System project. This document provides a comprehensive overview of the Admin features, covering everything from the underlying architecture to the step-by-step process of running the project locally.

## 📋 Overview
The Admin dashboard is designed to provide system administrators with full control over the attendance system. It allows administrators to manage users, courses, monitor system logs, and export detailed attendance reports. The frontend is built using React (Vite) with Tailwind CSS, while the backend is powered by FastAPI and Supabase.

---

## ✨ Key Features

1. **📊 System Overview (`SystemOverview.tsx`)**
   - A dashboard summarizing key metrics such as total users, active courses, and recent system activities.
   
2. **👥 User Management (`UserManagement.tsx`)**
   - **Create / Read / Update / Delete (CRUD)**: Manage student, teacher, and admin profiles.
   - **Role Management**: Assign and update user privileges.
   - **Registration Status**: Monitor whether users have registered their Face ID or NFC tags.

3. **📚 Course Management (`AllCoursesManagement.tsx`)**
   - View a complete list of all courses in the system.
   - Delete courses (cascades to delete related attendance records).

4. **📝 Registration Management (`RegistrationManagement.tsx`)**
   - Manage biometric and NFC registrations for students.

5. **📄 Export Reports (`ExportReports.tsx`)**
   - Export attendance histories for any course into multiple formats.
   - **Supported Formats**: Excel (`.xlsx`), CSV (`.csv`), and PDF (`.pdf`).
   - *Note*: PDF exports utilize `pdfmake` with full Thai language support via the `THSarabunNew` font natively loaded from the `/public/fonts` directory.

6. **📜 System Logs / Audit Logs (`SystemLogs.tsx`)**
   - Tracks all administrative actions (e.g., who deleted a user, who changed a role) for security and accountability.

---

## 🗄️ Backend Endpoints (FastAPI)
The backend REST API is located in `backend/routers/admin.py` and routes under the `/api/v1/admin` prefix. It integrates directly with Supabase.

### Users
- `GET /users` - Retrieve all user profiles.
- `POST /users` - Create a new user.
- `PUT /users/{user_id}/info` - Update user details.
- `PUT /users/{user_id}/role` - Update user role (admin/teacher/student).
- `DELETE /users/{user_id}` - Remove a user.

### Courses
- `GET /courses` - Retrieve all courses.
- `DELETE /courses/{course_id}` - Delete a course and its related data.

### Reports & Logs
- `GET /export/attendance/{course_id}` - Fetch structured attendance data for export.
- `GET /logs` - Fetch the audit logs of admin activities.

---

## 🚀 How to Run the Project

Follow these steps to run the Admin features locally from scratch:

### 1. Prerequisites
- **Node.js** (v18+ recommended)
- **Python** (v3.9+ recommended)
- **Supabase Account** (You need a Supabase project with configured tables: `profiles`, `courses`, `audit_logs`, `attendance_records`)

### 2. Backend Setup (FastAPI)
1. Open a terminal and navigate to the `backend` directory.
2. Create a virtual environment and activate it:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use: venv\Scripts\activate
   ```
3. Install the required Python packages:
   ```bash
   pip install -r requirements.txt
   ```
4. Create a `.env` file in the `backend` folder and add your Supabase credentials:
   ```env
   SUPABASE_URL="your-supabase-url"
   SUPABASE_KEY="your-supabase-anon-key"
   ```
5. Start the FastAPI server:
   ```bash
   uvicorn main:app --reload --port 8000
   ```
   *The backend will be available at `http://localhost:8000`*

### 3. Frontend Setup (React + Vite)
1. Open a new terminal window and navigate to the `frontend` directory.
2. Install the Node.js dependencies:
   ```bash
   npm install
   ```
3. Make sure your fonts are placed correctly in `frontend/public/fonts/` (specifically `THSarabunNew.ttf` for PDF exports).
4. Start the Vite development server:
   ```bash
   npm run dev
   ```
   *The frontend will be available at `http://localhost:5173`*

### 4. Accessing the Admin Panel
1. Open your browser and navigate to `http://localhost:5173`.
2. Log in using an account that has the `admin` role in the Supabase `profiles` table.
3. You will now have access to the Admin features such as User Management, Course Management, and PDF Exports!
