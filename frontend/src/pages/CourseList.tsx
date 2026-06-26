import React from 'react';
import { Link } from 'react-router-dom';
import { Users, FileBarChart, Book } from 'lucide-react';

const CourseList: React.FC = () => {
  // Mock data for now, ideally fetched from backend
  const courses = [
    { id: 1, code: 'CS101', name: 'Introduction to Computer Science' }
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-3xl font-extrabold text-slate-900 mb-2">My Courses</h1>
      <p className="text-slate-500 mb-8 text-lg">Manage attendance and view reports for your classes.</p>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {courses.map(course => (
          <div key={course.id} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-lg hover:-translate-y-1 hover:border-blue-200 transition-all duration-300 flex flex-col gap-5 group">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-blue-50 rounded-xl text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors duration-300">
                <Book size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-800">{course.code}</h2>
                <p className="text-slate-500 text-sm mt-1">{course.name}</p>
              </div>
            </div>
            
            <div className="h-px bg-slate-100 my-1 w-full"></div>
            
            <div className="flex gap-3 mt-auto">
              <Link to={`/courses/${course.id}/import`} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-slate-200 text-slate-600 font-semibold hover:border-blue-600 hover:text-blue-600 hover:bg-blue-50 transition-all">
                <Users size={18} /> Import
              </Link>
              <Link to={`/courses/${course.id}/report`} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-blue-500/40 transition-all">
                <FileBarChart size={18} /> Report
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CourseList;
