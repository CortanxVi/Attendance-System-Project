import React from 'react';
import { Link } from 'react-router-dom';
import { Users, FileBarChart, Book } from 'lucide-react';

const CourseList: React.FC = () => {
  // Mock data for now, ideally fetched from backend
  const courses = [
    { id: 1, code: 'CS101', name: 'Introduction to Computer Science' }
  ];

  return (
    <div>
      <h1 style={{ marginBottom: '8px', fontSize: '2rem', fontWeight: 700 }}>My Courses</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>Manage attendance and view reports for your classes.</p>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '24px' }}>
        {courses.map(course => (
          <div key={course.id} className="card card-hoverable" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <div style={{ padding: '12px', backgroundColor: '#EFF6FF', borderRadius: '12px', color: 'var(--primary-color)' }}>
                <Book size={24} />
              </div>
              <div>
                <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', fontWeight: 600 }}>{course.code}</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginTop: '4px' }}>{course.name}</p>
              </div>
            </div>
            
            <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }}></div>
            
            <div style={{ display: 'flex', gap: '12px', marginTop: 'auto' }}>
              <Link to={`/courses/${course.id}/import`} className="btn btn-outline" style={{ flex: 1 }}>
                <Users size={18} /> Import Data
              </Link>
              <Link to={`/courses/${course.id}/report`} className="btn btn-primary" style={{ flex: 1 }}>
                <FileBarChart size={18} /> View Report
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CourseList;
