interface StatCardProps {
  icon: string
  iconColor: 'purple' | 'cyan' | 'green' | 'red'
  value: string
  label: string
  trend?: string
  trendDirection?: 'up' | 'down'
}

export function StatCard({ icon, iconColor, value, label, trend, trendDirection }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card-header">
        <div className={`stat-card-icon ${iconColor}`}>{icon}</div>
        {trend && trendDirection && (
          <span className={`stat-card-trend ${trendDirection}`}>
            {trendDirection === 'up' ? '\u2191' : '\u2193'} {trend}
          </span>
        )}
      </div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  )
}
