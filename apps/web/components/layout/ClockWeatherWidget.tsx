'use client'

import { useEffect, useState } from 'react'
import { Cloud, Sun, CloudRain } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WeatherData {
  temp: number
  description: string
  icon: string
}

interface Props {
  compact?: boolean
}

const WEATHER_ICONS: Record<string, React.ElementType> = {
  Clear:       Sun,
  Clouds:      Cloud,
  Rain:        CloudRain,
  Drizzle:     CloudRain,
  Thunderstorm:CloudRain,
}

export default function ClockWeatherWidget({ compact = false }: Props) {
  const [time, setTime] = useState<string>('')
  const [date, setDate] = useState<string>('')
  const [weather, setWeather] = useState<WeatherData | null>(null)

  useEffect(() => {
    const update = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-UG', {
        timeZone: 'Africa/Nairobi',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }))
      setDate(now.toLocaleDateString('en-UG', {
        timeZone: 'Africa/Nairobi',
        weekday: compact ? undefined : 'short',
        month: 'short',
        day: 'numeric',
      }))
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [compact])

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_OPENWEATHER_KEY
    if (!key) return

    fetch(`https://api.openweathermap.org/data/2.5/weather?q=Kampala,UG&appid=${key}&units=metric`)
      .then((r) => r.json())
      .then((d) => {
        setWeather({
          temp: Math.round(d.main.temp),
          description: d.weather[0].main,
          icon: d.weather[0].main,
        })
      })
      .catch(() => {})
  }, [])

  const WeatherIcon = weather ? (WEATHER_ICONS[weather.description] || Sun) : Sun

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-gray-600">
        {weather && (
          <div className="flex items-center gap-1 text-xs">
            <WeatherIcon size={14} className="text-clinic-blue" />
            <span>{weather.temp}°C</span>
          </div>
        )}
        <span className="text-sm font-semibold text-gray-700">{time}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-white rounded-xl border border-gray-100 shadow-sm">
      {/* Clock */}
      <div className="text-center">
        <p className="text-2xl font-bold text-clinic-navy tabular-nums">{time}</p>
        <p className="text-xs text-gray-400 mt-0.5">{date} · Kampala</p>
      </div>

      {/* Weather */}
      {weather && (
        <>
          <div className="w-px h-10 bg-gray-200" />
          <div className="flex items-center gap-2">
            <WeatherIcon size={24} className="text-clinic-blue" />
            <div>
              <p className="text-lg font-bold text-clinic-navy">{weather.temp}°C</p>
              <p className="text-xs text-gray-400">{weather.description}</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
