import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Upload, ArrowLeft, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import { importStudents } from '../services/api';

const ImportPage: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{status: string, message: string} | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file || !courseId) return;
    setLoading(true);
    setResult(null);
    try {
      const data = await importStudents(Number(courseId), file);
      setResult({ status: 'success', message: data.message });
      setFile(null);
    } catch (error: any) {
      setResult({ status: 'error', message: error.response?.data?.detail || 'Error uploading file' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto animate-in fade-in duration-500">
      <Link to="/courses" className="inline-flex items-center gap-2 mb-6 text-slate-500 font-medium hover:text-slate-800 transition-colors">
        <ArrowLeft size={18} /> Back to Courses
      </Link>
      
      <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Import Student Data</h2>
        <p className="text-slate-500 mb-8 leading-relaxed">
          Upload a CSV file containing student information. The file must include <code className="bg-slate-100 px-2 py-0.5 rounded text-blue-600 font-mono text-sm">student_code</code>, <code className="bg-slate-100 px-2 py-0.5 rounded text-blue-600 font-mono text-sm">first_name</code>, and <code className="bg-slate-100 px-2 py-0.5 rounded text-blue-600 font-mono text-sm">last_name</code> columns.
        </p>
        
        <div className={`border-2 border-dashed rounded-2xl p-12 text-center mb-8 transition-all duration-300 relative ${file ? 'bg-blue-50 border-blue-400' : 'bg-slate-50 border-slate-300 hover:bg-slate-100 hover:border-slate-400'}`}>
          {file ? (
            <div className="flex flex-col items-center gap-3 animate-in zoom-in-95 duration-300">
              <div className="p-4 bg-blue-100 rounded-full text-blue-600">
                <FileText size={40} />
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-lg">{file.name}</p>
                <p className="text-slate-500 text-sm mt-1">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <button 
                onClick={() => setFile(null)} 
                className="mt-2 text-red-500 font-medium hover:text-red-700 underline underline-offset-2 transition-colors"
              >
                Remove file
              </button>
            </div>
          ) : (
            <>
              <div className="p-4 bg-white rounded-full inline-block shadow-sm mb-4 text-slate-400">
                <Upload size={32} />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Select a CSV file to upload</h3>
              <p className="mb-6 text-slate-500">Drag and drop it here, or click to browse</p>
              <input 
                type="file" 
                accept=".csv" 
                onChange={handleFileChange} 
                id="file-upload" 
                className="hidden" 
              />
              <label htmlFor="file-upload" className="inline-block cursor-pointer px-6 py-2.5 rounded-xl border-2 border-slate-200 text-slate-700 font-semibold bg-white hover:border-slate-300 hover:bg-slate-50 transition-colors">
                Browse Files
              </label>
            </>
          )}
        </div>

        {result && (
          <div className={`p-4 rounded-xl mb-8 flex items-center gap-3 text-sm font-medium animate-in slide-in-from-top-2 duration-300 ${result.status === 'success' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
            {result.status === 'success' ? <CheckCircle size={20} className="text-green-500 shrink-0" /> : <AlertCircle size={20} className="text-red-500 shrink-0" />}
            {result.message}
          </div>
        )}

        <div className="flex justify-end border-t border-slate-100 pt-6">
          <button 
            className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-semibold flex items-center justify-center gap-2 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-blue-500/40 transition-all min-w-[140px]"
            onClick={handleUpload} 
            disabled={!file || loading}
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white/30 border-t-white"></div>
                Uploading...
              </>
            ) : (
              'Upload Data'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportPage;
