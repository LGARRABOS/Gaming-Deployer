import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiPutRaw } from "../api/client";

interface FileEntry {
  name: string;
  size: number;
  mtime: number;
  dir: boolean;
}

interface Props {
  serverId: number;
}

const basePath = "/api/servers";

export const ServerFileBrowser: React.FC<Props> = ({ serverId }) => {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorSaving, setEditorSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [mkdirLoading, setMkdirLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ ok: boolean; entries?: FileEntry[] }>(
        `${basePath}/${serverId}/files?path=${encodeURIComponent(currentPath)}`
      );
      setEntries(res?.entries ?? []);
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur liste");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [serverId, currentPath]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const breadcrumbs = currentPath ? currentPath.split("/").filter(Boolean) : [];
  const openDir = (name: string) => {
    setCurrentPath(currentPath ? `${currentPath}/${name}` : name);
    setSelected(null);
  };
  const goUp = () => {
    setCurrentPath(breadcrumbs.slice(0, -1).join("/"));
    setSelected(null);
  };
  const goRoot = () => {
    setCurrentPath("");
    setSelected(null);
  };

  const openFile = useCallback(
    async (path: string) => {
      setEditorPath(path);
      setError(null);
      try {
        const res = await apiGet<{ ok: boolean; content?: string }>(
          `${basePath}/${serverId}/files/content?path=${encodeURIComponent(path)}`
        );
        if (res?.content != null) {
          try {
            setEditorContent(atob(res.content));
          } catch {
            setEditorContent("[Fichier binaire – téléchargez pour récupérer]");
          }
        } else {
          setEditorContent("");
        }
      } catch (e: unknown) {
        setError((e as Error).message ?? "Erreur chargement fichier");
        setEditorContent("");
      }
    },
    [serverId]
  );

  const saveFile = useCallback(async () => {
    if (editorPath == null) return;
    setEditorSaving(true);
    setError(null);
    try {
      const url = `${basePath}/${serverId}/files/content?path=${encodeURIComponent(editorPath)}`;
      const out = await apiPutRaw(url, editorContent);
      if (out?.ok !== true) {
        setError(out?.error ?? "Erreur enregistrement");
      } else {
        setEditorPath(null);
      }
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur enregistrement");
    } finally {
      setEditorSaving(false);
    }
  }, [serverId, editorPath, editorContent]);

  const downloadFile = useCallback(
    async (path: string) => {
      const url = `${basePath}/${serverId}/files/content?path=${encodeURIComponent(path)}&download=1`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        setError("Téléchargement échoué");
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = path.split("/").pop() ?? "download";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    },
    [serverId]
  );

  const deleteSelected = useCallback(async () => {
    if (selected == null) return;
    if (!window.confirm(`Supprimer « ${selected} » ?`)) return;
    const fullPath = currentPath ? `${currentPath}/${selected}` : selected;
    setError(null);
    try {
      await apiDelete(
        `${basePath}/${serverId}/files?path=${encodeURIComponent(fullPath)}`
      );
      setSelected(null);
      fetchList();
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur suppression");
    }
  }, [serverId, currentPath, selected, fetchList]);

  const uploadFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      setError(null);
      const form = new FormData();
      form.append("file", file);
      if (currentPath) form.append("path", currentPath);
      try {
        const res = await fetch(`${basePath}/${serverId}/files?path=${encodeURIComponent(currentPath)}`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data?.ok) {
          setError(data?.error ?? "Erreur upload");
        } else {
          fetchList();
        }
      } catch (err: unknown) {
        setError((err as Error).message ?? "Erreur upload");
      } finally {
        setUploading(false);
        e.target.value = "";
      }
    },
    [serverId, currentPath, fetchList]
  );

  const createDir = useCallback(async () => {
    const name = mkdirName.trim();
    if (!name) return;
    setMkdirLoading(true);
    setError(null);
    const form = new FormData();
    form.append("mkdir", name);
    if (currentPath) form.append("path", currentPath);
    try {
      const res = await fetch(`${basePath}/${serverId}/files?path=${encodeURIComponent(currentPath)}`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Erreur création dossier");
      } else {
        setMkdirName("");
        fetchList();
      }
    } catch (err: unknown) {
      setError((err as Error).message ?? "Erreur création dossier");
    } finally {
      setMkdirLoading(false);
    }
  }, [serverId, currentPath, mkdirName, fetchList]);

  const formatSize = (n: number) => (n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} Ko` : `${(n / (1024 * 1024)).toFixed(1)} Mo`);
  const formatDate = (ts: number) => (ts ? new Date(ts * 1000).toLocaleString() : "");

  if (editorPath != null) {
    return (
      <div className="server-files-editor">
        <div className="server-files-editor-header">
          <button type="button" className="server-btn" onClick={() => setEditorPath(null)}>
            ← Retour
          </button>
          <span className="server-files-editor-title">{editorPath}</span>
        </div>
        <textarea
          className="server-files-editor-textarea"
          value={editorContent}
          onChange={(e) => setEditorContent(e.target.value)}
          spellCheck={false}
        />
        {error && <p className="error server-panel-error">{error}</p>}
        <div className="server-files-editor-actions">
          <button type="button" className="server-btn server-btn--primary" onClick={saveFile} disabled={editorSaving}>
            {editorSaving ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button type="button" className="server-btn" onClick={() => downloadFile(editorPath)}>
            Télécharger
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="server-files-browser">
      <div className="server-files-toolbar">
        <div className="server-files-breadcrumb">
          <button type="button" className="server-files-breadcrumb-item" onClick={goRoot}>
            racine
          </button>
          {breadcrumbs.map((seg, i) => (
            <React.Fragment key={i}>
              <span className="server-files-breadcrumb-sep">/</span>
              <button
                type="button"
                className="server-files-breadcrumb-item"
                onClick={() => setCurrentPath(breadcrumbs.slice(0, i + 1).join("/"))}
              >
                {seg}
              </button>
            </React.Fragment>
          ))}
        </div>
        <div className="server-files-actions">
          <button type="button" className="server-btn server-btn--primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? "Envoi…" : "Envoyer un fichier"}
          </button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={uploadFile} />
          <div className="server-files-mkdir">
            <input
              type="text"
              placeholder="Nouveau dossier"
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createDir()}
            />
            <button type="button" className="server-btn" onClick={createDir} disabled={!mkdirName.trim() || mkdirLoading}>
              {mkdirLoading ? "…" : "Créer"}
            </button>
          </div>
          <button type="button" className="server-btn" onClick={fetchList} disabled={loading}>
            Actualiser
          </button>
          {selected && (
            <button type="button" className="server-btn server-btn--danger" onClick={deleteSelected}>
              Supprimer « {selected} »
            </button>
          )}
        </div>
      </div>
      {error && <p className="error server-panel-error">{error}</p>}
      <div className="server-files-list-wrap">
        {loading ? (
          <p className="server-panel-desc">Chargement…</p>
        ) : (
          <table className="server-files-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Taille</th>
                <th>Modifié</th>
              </tr>
            </thead>
            <tbody>
              {currentPath ? (
                <tr>
                  <td colSpan={3}>
                    <button type="button" className="server-files-row-link" onClick={goUp}>
                      ..
                    </button>
                  </td>
                </tr>
              ) : null}
              {entries.map((ent) => (
                <tr key={ent.name} className={selected === ent.name ? "selected" : ""}>
                  <td>
                    {ent.dir ? (
                      <button
                        type="button"
                        className="server-files-row-link"
                        onClick={() => setSelected(ent.name)}
                        onDoubleClick={() => openDir(ent.name)}
                      >
                        📁 {ent.name}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="server-files-row-link"
                        onClick={() => {
                          setSelected(ent.name);
                        }}
                        onDoubleClick={() => openFile(currentPath ? `${currentPath}/${ent.name}` : ent.name)}
                      >
                        📄 {ent.name}
                      </button>
                    )}
                  </td>
                  <td>{ent.dir ? "—" : formatSize(ent.size)}</td>
                  <td>{formatDate(ent.mtime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && entries.length === 0 && !currentPath && (
          <p className="server-panel-desc">Dossier vide ou inaccessible.</p>
        )}
      </div>
    </div>
  );
};
