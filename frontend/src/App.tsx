import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import CourseList from './pages/CourseList';
import ImportPage from './pages/ImportPage';
import AttendanceReport from './pages/AttendanceReport';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-300">
        <Navbar />
        <main className="container mx-auto px-4 pt-8 pb-16 max-w-6xl">
          <Routes>
            <Route path="/" element={<Navigate to="/courses" replace />} />
            <Route path="/courses" element={<CourseList />} />
            <Route path="/courses/:courseId/import" element={<ImportPage />} />
            <Route path="/courses/:courseId/report" element={<AttendanceReport />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
