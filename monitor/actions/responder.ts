  const alerts = new Map<string, { alert: Alert; run: Run; who: "primary" | "backup" }>(); // by alert id, kept so a repeated ack is harmless
    alerts.set(alert.id, { alert, run, who });
        // The number never leaves the monitor; who and the risk's kind and room give the caregiver context
        alerts: [...alerts.values()].map(({ alert, run, who }) => ({ ...alert, to: alert.to ? "(set)" : "", who, kind: run.risk.kind, roomId: run.risk.roomId })),
