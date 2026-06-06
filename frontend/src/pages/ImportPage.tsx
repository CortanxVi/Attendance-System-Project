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
    <div style={{ maxWidth: '640px', margin: '0 auto' }}>
      <Link to="/courses" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '24px', color: 'var(--text-secondary)', fontWeight: 500, transition: 'color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}>
        <ArrowLeft size={18} /> Back to Courses
      </Link>
      
      <div className="card">
        <h2 style={{ marginBottom: '8px', fontSize: '1.5rem', fontWeight: 600 }}>Import Student Data</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', lineHeight: 1.5 }}>
          Upload a CSV file containing student information. The file must include <code style={{backgroundColor:'#F1F5F9', padding:'2px 6px', borderRadius:'4px', color:'#3B82F6'}}>student_code</code>, <code style={{backgroundColor:'#F1F5F9', padding:'2px 6px', borderRadius:'4px', color:'#3B82F6'}}>first_name</code>, and <code style={{backgroundColor:'#F1F5F9', padding:'2px 6px', borderRadius:'4px', color:'#3B82F6'}}>last_name</code> columns.
        </p>
        
        <div style={{ 
          border: '2px dashed #CBD5E1', 
          borderRadius: '16px', 
          padding: '48px 24px', 
          textAlign: 'center',
          backgroundColor: file ? '#EFF6FF' : '#F8FAFC',
          borderColor: file ? '#60A5FA' : '#CBD5E1',
          marginBottom: '32px',
          transition: 'all 0.2s ease',
          position: 'relative'
        }}>
          {file ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <div style={{ padding: '16px', backgroundColor: '#DBEAFE', borderRadius: '50%', color: 'var(--primary-color)' }}>
                <FileText size={40} />
              </div>
              <div>
                <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '1.1rem' }}>{file.name}</p>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <button 
                onClick={() => setFile(null)} 
                style={{ marginTop: '8px', background: 'none', border: 'none', color: '#EF4444', fontWeight: 500, cursor: 'pointer', textDecoration: 'underline' }}
              >
                Remove file
              </button>
            </div>
          ) : (
            <>
              <div style={{ padding: '16px', backgroundColor: 'white', borderRadius: '50%', display: 'inline-block', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '16px', color: 'var(--text-secondary)' }}>
                <Upload size={32} />
              </div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>Select a CSV file to upload</h3>
              <p style={{ marginBottom: '24px', color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Drag and drop it here, or click to browse</p>
              <input 
                type="file" 
                accept=".csv" 
                onChange={handleFileChange} 
                id="file-upload" 
                style={{ display: 'none' }} 
              />
              <label htmlFor="file-upload" className="btn btn-outline" style={{ backgroundColor: 'white' }}>
                Browse Files
              </label>
            </>
          )}
        </div>

        {result && (
          <div style={{ 
            padding: '16px', 
            borderRadius: '12px', 
            marginBottom: '32px',
            backgroundColor: result.status === 'success' ? '#F0FDF4' : '#FEF2F2',
            border: `1px solid ${result.status === 'success' ? '#BBF7D0' : '#FECACA'}`,
            color: result.status === 'success' ? '#166534' : '#991B1B',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '0.95rem',
            fontWeight: 500
          }}>
            {result.status === 'success' ? <CheckCircle size={20} color="#10B981" /> : <AlertCircle size={20} color="#EF4444" />}
            {result.message}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
          <button 
            className="btn btn-primary" 
            onClick={handleUpload} 
            disabled={!file || loading}
            style={{ width: loading ? '140px' : 'auto' }}
          >
            {loading ? (
              <>
                <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }}></div>
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
