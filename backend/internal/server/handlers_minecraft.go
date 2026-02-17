package server

import (
	"net/http"

	"github.com/example/proxmox-game-deployer/internal/minecraft"
)

// handleMinecraftVersions returns the list of vanilla release versions (1.x.x only) and, for Forge, one recommended build per MC version.
func (s *Server) handleMinecraftVersions(w http.ResponseWriter, r *http.Request) {
	list, latest, err := minecraft.GetVanillaReleaseVersions()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	ids := make([]string, 0, len(list))
	for _, v := range list {
		ids = append(ids, v.ID)
	}
	out := map[string]any{
		"versions": ids,
		"latest":   latest,
	}
	forgeList, errForge := minecraft.GetForgeReleaseVersions()
	if errForge == nil && len(forgeList) > 0 {
		forgePayload := make([]map[string]string, 0, len(forgeList))
		for _, f := range forgeList {
			forgePayload = append(forgePayload, map[string]string{
				"mc_version":   f.MCVersion,
				"forge_build":  f.ForgeBuild,
				"full_version": f.FullVersion,
			})
		}
		out["forge_versions"] = forgePayload
	}
	writeJSON(w, http.StatusOK, out)
}
