import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AuthProvider from './auth/AuthProvider'
import ProtectedRoute from './auth/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import ProjectListPage from './pages/ProjectListPage'
import ProjectWorkspacePage from './pages/ProjectWorkspacePage'
import PublicPassportPage from './pages/PublicPassportPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/p/:publicId" element={<PublicPassportPage />} />
          <Route
            path="/projects"
            element={
              <ProtectedRoute>
                <ProjectListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects/:projectId"
            element={
              <ProtectedRoute>
                <ProjectWorkspacePage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
