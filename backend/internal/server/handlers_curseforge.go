package server

import (
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/example/proxmox-game-deployer/internal/config"
	"github.com/example/proxmox-game-deployer/internal/curseforge"
)

type curseForgeModpackResult struct {
	ID      int     `json:"id"`
	Name    string  `json:"name"`
	Slug    string  `json:"slug"`
	Summary string  `json:"summary"`
	LogoURL *string `json:"logo_url,omitempty"`
}

type curseForgeServerPackFile struct {
	FileID      int      `json:"file_id"`
	DisplayName string   `json:"display_name"`
	FileName    string   `json:"file_name"`
	GameVersions []string `json:"game_versions,omitempty"`
	FileDate    *string  `json:"file_date,omitempty"`
}

func (s *Server) curseForgeClientFromSettings(r *http.Request) (*curseforge.Client, error) {
	key, err := config.LoadCurseForgeAPIKey(r.Context(), s.DB)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(key) == "" {
		return nil, errUser("Clé API CurseForge non configurée. Va dans Paramètres → CurseForge.")
	}
	return curseforge.New(key), nil
}

type userError struct{ msg string }

func (e userError) Error() string { return e.msg }

func errUser(msg string) error { return userError{msg: msg} }

func writeUserOrServerError(w http.ResponseWriter, err error) {
	var ue userError
	if errors.As(err, &ue) {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	http.Error(w, err.Error(), http.StatusInternalServerError)
}

// handleCurseForgeSearchModpacks searches Minecraft modpacks by query string.
func (s *Server) handleCurseForgeSearchModpacks(w http.ResponseWriter, r *http.Request) {
	cf, err := s.curseForgeClientFromSettings(r)
	if err != nil {
		writeUserOrServerError(w, err)
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, http.StatusOK, map[string]any{"data": []curseForgeModpackResult{}})
		return
	}
	mods, err := cf.SearchModpacks(r.Context(), q, 20)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	out := make([]curseForgeModpackResult, 0, len(mods))
	for _, m := range mods {
		var logo *string
		if m.Logo != nil {
			if m.Logo.ThumbnailURL != "" {
				v := m.Logo.ThumbnailURL
				logo = &v
			} else if m.Logo.URL != "" {
				v := m.Logo.URL
				logo = &v
			}
		}
		out = append(out, curseForgeModpackResult{
			ID:      m.ID,
			Name:    m.Name,
			Slug:    m.Slug,
			Summary: m.Summary,
			LogoURL: logo,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": out})
}

// handleCurseForgeListServerPacks returns server pack files for a modpack project, when available.
func (s *Server) handleCurseForgeListServerPacks(w http.ResponseWriter, r *http.Request) {
	cf, err := s.curseForgeClientFromSettings(r)
	if err != nil {
		writeUserOrServerError(w, err)
		return
	}
	idStr := chi.URLParam(r, "id")
	modID, err := strconv.Atoi(idStr)
	if err != nil || modID <= 0 {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	files, err := cf.ListFiles(r.Context(), modID, 50)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	// Gather serverPackFileId values.
	serverIDs := make(map[int]struct{})
	for _, f := range files {
		if f.ServerPackFileID != nil && *f.ServerPackFileID > 0 {
			serverIDs[*f.ServerPackFileID] = struct{}{}
		}
	}
	out := make([]curseForgeServerPackFile, 0, len(serverIDs))
	for fileID := range serverIDs {
		ff, err := cf.GetFile(r.Context(), modID, fileID)
		if err != nil {
			continue
		}
		out = append(out, curseForgeServerPackFile{
			FileID:       ff.ID,
			DisplayName:  firstNonEmpty(ff.DisplayName, ff.FileName),
			FileName:     ff.FileName,
			GameVersions: ff.GameVersions,
			FileDate:     ff.FileDate,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		// file_date is ISO-8601; lexicographic order works.
		di := ""
		dj := ""
		if out[i].FileDate != nil {
			di = *out[i].FileDate
		}
		if out[j].FileDate != nil {
			dj = *out[j].FileDate
		}
		return dj < di
	})
	writeJSON(w, http.StatusOK, map[string]any{"data": out})
}

func firstNonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}

