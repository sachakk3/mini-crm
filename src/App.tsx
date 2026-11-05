import {
  Navigate,
  Route,
  Routes,
  Link,
  NavLink,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import TaskDetail from "./pages/TaskDetail";
import MyTasks from "./pages/MyTasks";
import { ROLE_LABELS } from "./lib/types";

function TopBar() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="topbar">
      <Link to="/" className="brand">
        Мини-CRM
      </Link>
      <nav>
        <NavLink to="/" end>
          Объекты
        </NavLink>
        {profile?.role === "worker" && (
          <NavLink to="/my-tasks">Мои задачи</NavLink>
        )}
      </nav>
      <div className="spacer" />
      {profile && (
        <div className="user-info">
          <div>{profile.full_name || profile.email}</div>
          <div>{ROLE_LABELS[profile.role]}</div>
        </div>
      )}
      <button
        onClick={() => {
          signOut();
          navigate("/login");
        }}
      >
        Выйти
      </button>
    </header>
  );
}

export default function App() {
  const { session, profile, loading, profileError } = useAuth();

  if (loading)
    return (
      <div className="container">
        <p>Загрузка…</p>
      </div>
    );

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (!profile) {
    return (
      <div className="container">
        <p className="error">{profileError ?? "Профиль не найден."}</p>
        <button onClick={() => window.location.reload()}>Обновить</button>
      </div>
    );
  }

  return (
    <>
      <TopBar />
      <main className="container">
        <Routes>
          <Route path="/" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/tasks/:id" element={<TaskDetail />} />
          <Route path="/my-tasks" element={<MyTasks />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
