import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import RegisterFace from './pages/RegisterFace';
import CheckIn from './pages/CheckIn';
import History from './pages/History';
import FaceTester from './pages/FaceTester';

const ProtectedRoute = ({ children }) => {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        
        <Route path="/register-face" element={
          <ProtectedRoute>
            <RegisterFace />
          </ProtectedRoute>
        } />
        
        <Route path="/check-in" element={
          <ProtectedRoute>
            <CheckIn />
          </ProtectedRoute>
        } />
        
        <Route path="/history" element={
          <ProtectedRoute>
            <History />
          </ProtectedRoute>
        } />
        
        <Route path="/face-tester" element={
          <ProtectedRoute>
            <FaceTester />
          </ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
