package server

import (
	"net/http"

	"github.com/example/proxmox-game-deployer/internal/minecraft"
)

// handleMinecraftVersions returns the list of vanilla release versions (1.x.x only) for the deploy form.
func (s *Server) handleMinecraftVersions(w http.ResponseWriter, r *http.Request) {
	list, latest, err := minecraft.GetVanillaReleaseVersions()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	// Return minimal payload: id only for dropdown; latest for default selection.
	ids := make([]string, 0, len(list))
	for _, v := range list {
		ids = append(ids, v.ID)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"versions": ids,
		"latest":   latest,
	})
}
