import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';

const Navbar: React.FC = () => {
  return (
    <nav style={{ 
      backgroundColor: 'rgba(255, 255, 255, 0.85)', 
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(226, 232, 240, 0.8)', 
      padding: '16px 0',
      position: 'sticky',
      top: 0,
      zIndex: 50,
      boxShadow: '0 4px 20px -10px rgba(0, 0, 0, 0.05)'
    }}>
      <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ 
            padding: '10px', 
            background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)', 
            borderRadius: '14px', 
            color: 'white',
            boxShadow: '0 4px 10px rgba(37, 99, 235, 0.3)'
          }}>
            <BookOpen size={24} strokeWidth={2.5} />
          </div>
          <span style={{ fontWeight: 800, fontSize: '1.4rem', fontFamily: 'Outfit, sans-serif', letterSpacing: '-0.03em' }}>
            Attendance<span style={{color: 'var(--primary-color)'}}>Sys</span>
          </span>
        </Link>
        <div style={{ display: 'flex', gap: '32px' }}>
          <Link to="/courses" style={{ 
            color: 'var(--text-primary)', 
            fontWeight: 600, 
            transition: 'all 0.2s',
            padding: '8px 16px',
            borderRadius: '8px'
          }} onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#F1F5F9';
            e.currentTarget.style.color = 'var(--primary-color)';
          }} onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}>
            My Courses
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
