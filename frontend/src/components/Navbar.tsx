import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';

const Navbar: React.FC = () => {
  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200/80 shadow-sm py-4">
      <div className="container mx-auto px-4 max-w-6xl flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="p-2.5 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl text-white shadow-lg shadow-blue-500/30 group-hover:scale-105 transition-transform duration-300">
            <BookOpen size={24} strokeWidth={2.5} />
          </div>
          <span className="font-extrabold text-2xl tracking-tight font-sans text-slate-800">
            Attendance<span className="text-blue-600">Sys</span>
          </span>
        </Link>
        <div className="flex gap-8">
          <Link to="/courses" className="text-slate-600 font-semibold transition-all duration-200 hover:text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg">
            My Courses
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
