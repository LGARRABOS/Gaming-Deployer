package curseforge

// Modpack represents a CurseForge project (modpack).
// Only fields we need are defined; the API returns more.
type Modpack struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	Slug    string `json:"slug"`
	Summary string `json:"summary"`

	Logo *struct {
		ThumbnailURL string `json:"thumbnailUrl"`
		URL          string `json:"url"`
	} `json:"logo,omitempty"`
}

// File represents a CurseForge file (version).
// For modpacks, serverPackFileId may point to the server pack file.
type File struct {
	ID              int      `json:"id"`
	DisplayName     string   `json:"displayName"`
	FileName        string   `json:"fileName"`
	DownloadURL     *string  `json:"downloadUrl,omitempty"`
	ServerPackFileID *int     `json:"serverPackFileId,omitempty"`
	GameVersions    []string `json:"gameVersions,omitempty"`
	ReleaseType     *int     `json:"releaseType,omitempty"`
	FileDate        *string  `json:"fileDate,omitempty"`
}

