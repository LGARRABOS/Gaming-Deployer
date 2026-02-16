package server

import (
	"context"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gorcon/rcon"

	"github.com/example/proxmox-game-deployer/internal/config"
	"github.com/example/proxmox-game-deployer/internal/deploy"
	"github.com/example/proxmox-game-deployer/internal/proxmox"
	"github.com/example/proxmox-game-deployer/internal/sshexec"
)

const (
	monitoringInterval   = 60 * time.Second
	monitoringRetention  = 12 * time.Hour
	monitoringMaxSamples = 12 * 60 // 720 points
)

// collectMonitoringSample fetches one sample for a deployment (metrics + optional minecraft).
func (s *Server) collectMonitoringSample(ctx context.Context, deploymentID int64) (
	cpu, ramPct, diskPct float64, tps *float64, players *int, err error) {
	node, vmid, _, err := s.getServerProxmoxTarget(ctx, deploymentID)
	if err != nil {
		return 0, 0, 0, nil, nil, err
	}
	cfg, err := config.LoadProxmoxConfig(ctx, s.DB)
	if err != nil {
		return 0, 0, 0, nil, nil, err
	}
	client, err := proxmox.NewClient(cfg.APIURL, cfg.APITokenID, cfg.APITokenSecret)
	if err != nil {
		return 0, 0, 0, nil, nil, err
	}
	status, err := client.GetVMStatusCurrent(ctx, node, int(vmid))
	if err != nil {
		return 0, 0, 0, nil, nil, err
	}
	cpu = status.CPU * 100
	if cpu > 100 {
		cpu = 100
	}
	if status.MaxMem > 0 {
		ramPct = 100 * float64(status.Mem) / float64(status.MaxMem)
	}
	if status.MaxDisk > 0 && status.Disk > 0 {
		diskPct = 100 * float64(status.Disk) / float64(status.MaxDisk)
	}
	if status.MaxDisk == 0 || status.Disk == 0 {
		ip, sshUser, err := s.getServerSSHTarget(ctx, deploymentID)
		if err == nil {
			stdout, _, _ := sshexec.RunCommand(ctx, ip, sshUser, sshexec.KeyPath(), "df -B1 / | tail -1")
			fields := strings.Fields(stdout)
			if len(fields) >= 4 {
				total, _ := strconv.ParseInt(fields[1], 10, 64)
				used, _ := strconv.ParseInt(fields[2], 10, 64)
				if total > 0 {
					diskPct = 100 * float64(used) / float64(total)
				}
			}
		}
	}
	// Optional: RCON for players + TPS
	ip, _, err := s.getServerSSHTarget(ctx, deploymentID)
	if err != nil {
		return cpu, ramPct, diskPct, nil, nil, nil
	}
	port, password, err := s.getServerRCONConfig(ctx, deploymentID)
	if err != nil {
		return cpu, ramPct, diskPct, nil, nil, nil
	}
	rconClient, err := rcon.Dial(ip+":"+strconv.Itoa(port), password)
	if err != nil {
		return cpu, ramPct, diskPct, nil, nil, nil
	}
	defer rconClient.Close()
	resp, err := rconClient.Execute("list")
	if err != nil {
		return cpu, ramPct, diskPct, nil, nil, nil
	}
	re := regexp.MustCompile(`(?i)there are (\d+) of a max of (\d+) players online:`)
	matches := re.FindStringSubmatch(strings.TrimSpace(resp))
	if len(matches) >= 2 {
		n, _ := strconv.Atoi(matches[1])
		players = &n
	}
	tpsResp, tpsErr := rconClient.Execute("tps")
	if tpsErr == nil {
		tpsRe := regexp.MustCompile(`\d+\.?\d*`)
		tpsNums := tpsRe.FindAllString(tpsResp, -1)
		if len(tpsNums) >= 1 {
			v, _ := strconv.ParseFloat(tpsNums[len(tpsNums)-1], 64)
			tps = &v
		}
	}
	return cpu, ramPct, diskPct, tps, players, nil
}

// RunMonitoringCollector runs in the background: collect once at start, then every minute.
func (s *Server) RunMonitoringCollector() {
	ticker := time.NewTicker(monitoringInterval)
	defer ticker.Stop()
	for {
		s.runMonitoringCollectorOnce()
		<-ticker.C
	}
}

func (s *Server) runMonitoringCollectorOnce() {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	rows, err := s.DB.Sql().QueryContext(ctx, `
		SELECT id FROM deployments WHERE game = ? AND status = ?
	`, "minecraft", string(deploy.StatusSuccess))
	if err != nil {
		log.Printf("monitoring: list deployments: %v", err)
		return
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			continue
		}
		ids = append(ids, id)
	}
	rows.Close()
	now := time.Now().Unix()
	cutoff := time.Now().Add(-monitoringRetention).Unix()
	for _, id := range ids {
		cpu, ramPct, diskPct, tpsVal, playersVal, err := s.collectMonitoringSample(ctx, id)
		if err != nil {
			continue
		}
		var tpsNull, playersNull interface{}
		if tpsVal != nil {
			tpsNull = *tpsVal
		} else {
			tpsNull = nil
		}
		if playersVal != nil {
			playersNull = *playersVal
		} else {
			playersNull = nil
		}
		_, err = s.DB.Sql().ExecContext(ctx, `
			INSERT OR REPLACE INTO monitoring_samples (deployment_id, ts, cpu, ram_pct, disk_pct, tps, players) VALUES (?, ?, ?, ?, ?, ?, ?)
		`, id, now, cpu, ramPct, diskPct, tpsNull, playersNull)
		if err != nil {
			continue
		}
		_, _ = s.DB.Sql().ExecContext(ctx, `DELETE FROM monitoring_samples WHERE deployment_id = ? AND ts < ?`, id, cutoff)
	}
}
