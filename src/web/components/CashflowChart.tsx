import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CashflowDay, ForecastPoint } from '@shared/types';
import { dayLabel, money } from '../lib/format';

interface ChartRow {
  label: string;
  actual: number | null;
  expected: number | null;
  bandBase: number;
  bandSpan: number;
}

/**
 * Cash-flow history + forecast with an 80% band. The band is drawn as a
 * stacked area: an invisible "pedestal" up to `low`, then the band span.
 */
export function CashflowChart({ series, forecast, showBand = true }: { series: CashflowDay[]; forecast: ForecastPoint[]; showBand?: boolean }) {
  const data = useMemo<ChartRow[]>(() => {
    const rows: ChartRow[] = [];
    const forecastByDate = new Map(forecast.map((p) => [p.date, p]));
    for (const d of series) {
      rows.push({
        label: dayLabel(d.date),
        actual: d.net,
        expected: null,
        bandBase: 0,
        bandSpan: 0,
      });
    }
    const lastRow = rows[rows.length - 1];
    const lastForecast = forecastByDate.get(series[series.length - 1]?.date ?? '');
    if (lastRow && lastForecast) {
      lastRow.expected = lastForecast.expected;
    }
    for (const p of forecast) {
      rows.push({
        label: dayLabel(p.date),
        actual: null,
        expected: p.expected,
        bandBase: showBand ? Math.max(p.low, 0) : 0,
        bandSpan: showBand ? Math.max(p.high - Math.max(p.low, 0), 0) : 0,
      });
    }
    return rows;
  }, [series, forecast, showBand]);

  const forecastStart = series.length - 1;

  return (
    <ResponsiveContainer width="100%" height={290}>
      <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="label" minTickGap={46} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
        <YAxis
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
          width={44}
        />
        <Tooltip
          contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 8px 24px -12px rgb(15 34 58 / .25)' }}
          formatter={(value, name) => {
            if (name === 'bandSpan' || name === 'band-base') return ['', ''];
            const n = Number(value);
            return [money(n, false), name === 'actual' ? 'Actual net' : 'Forecast'];
          }}
          labelFormatter={(label) => {
            const idx = data.findIndex((row) => row.label === label);
            return idx >= forecastStart ? `${label} · forecast` : String(label);
          }}
        />
        <Legend
          formatter={(value) => (
            <span className="text-[11px] text-slate-500">
              {value === 'actual' ? 'Actual net' : value === 'expected' ? 'Forecast (expected)' : '80% band'}
            </span>
          )}
          iconSize={10}
        />
        {showBand && (
          <Area dataKey="bandBase" stackId="band" stroke="none" fill="transparent" name="band-base" legendType="none" isAnimationActive={false} />
        )}
        {showBand && (
          <Area
            dataKey="bandSpan"
            stackId="band"
            stroke="none"
            fill="#23c2b8"
            fillOpacity={0.14}
            name="bandSpan"
            isAnimationActive={false}
          />
        )}
        <Area dataKey="actual" stroke="#142b47" strokeWidth={2} fill="#142b47" fillOpacity={0.06} name="actual" connectNulls={false} dot={false} />
        <Line
          dataKey="expected"
          stroke="#0da49e"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
          name="expected"
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
