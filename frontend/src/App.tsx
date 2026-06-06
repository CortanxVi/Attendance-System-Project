import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import CourseList from './pages/CourseList';
import ImportPage from './pages/ImportPage';
import AttendanceReport from './pages/AttendanceReport';
import './index.css';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="container" style={{ paddingTop: '32px', paddingBottom: '64px' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/courses" replace />} />
            <Route path="/courses" element={<CourseList />} />
            <Route path="/courses/:courseId/import" element={<ImportPage />} />
            <Route path="/courses/:courseId/report" element={<AttendanceReport />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
