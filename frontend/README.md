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

The complete, current setup guide is maintained in the project-root `README.md`.
The supported development matrix is:

- Node.js 22.12+ or 24
- Python 3.12 x64
- Windows 10/11, Ubuntu, Linux Mint, or Fedora
- Supabase schema applied from the project-root `supabase/migrations` directory

Windows first-time setup and startup:

```bat
setup_windows.bat
start_all.bat
```

Linux startup after preparing the three environment files:

```bash
./start_all.sh
```

Keep the Supabase service-role key only in `backend/.env`. The frontend receives
only a publishable/anon key, and the isolated Light OCR environment must not
contain any Supabase credential.
