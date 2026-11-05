import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import type { Project } from "../lib/types";

export default function Projects() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Форма создания/редактирования (только постановщик)
  const [editing, setEditing] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");

  const isManager = profile?.role === "manager";

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (err) setError(err.message);
    else {
      setProjects((data as Project[]) ?? []);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startCreate = () => {
    setEditing(null);
    setName("");
    setAddress("");
  };

  const startEdit = (p: Project) => {
    setEditing(p);
    setName(p.name);
    setAddress(p.address);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (editing) {
      const { error: err } = await supabase
        .from("projects")
        .update({ name, address })
        .eq("id", editing.id);
      if (err) {
        setError(err.message);
        return;
      }
    } else {
      const { error: err } = await supabase
        .from("projects")
        .insert({ name, address, created_by: profile!.id });
      if (err) {
        setError(err.message);
        return;
      }
    }
    startCreate();
    void load();
  };

  const onDelete = async (p: Project) => {
    if (!confirm(`Удалить объект «${p.name}» и все его задачи?`)) return;
    const { error: err } = await supabase
      .from("projects")
      .delete()
      .eq("id", p.id);
    if (err) setError(err.message);
    void load();
  };

  return (
    <div>
      <h1>Объекты</h1>
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Загрузка…</p>}

      {isManager && (
        <div className="card">
          <h2>{editing ? "Редактирование объекта" : "Новый объект"}</h2>
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="p-name">Название</label>
              <input
                id="p-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="p-address">Адрес</label>
              <input
                id="p-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            <button className="primary" type="submit">
              {editing ? "Сохранить" : "Создать"}
            </button>
            {editing && (
              <button type="button" onClick={startCreate}>
                Отмена
              </button>
            )}
          </form>
        </div>
      )}

      {!loading && projects.length === 0 && (
        <p className="muted">Объектов пока нет.</p>
      )}

      {projects.map((p) => (
        <div
          key={p.id}
          className="card clickable"
          onClick={() => navigate(`/projects/${p.id}`)}
        >
          <strong>{p.name}</strong>
          <div className="muted">{p.address}</div>
          {isManager && (
            <div style={{ marginTop: 8 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit(p);
                }}
              >
                Редактировать
              </button>
              <button
                className="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  void onDelete(p);
                }}
              >
                Удалить
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
