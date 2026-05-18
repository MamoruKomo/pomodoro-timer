import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import {
  Bell,
  Clock,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
} from 'lucide-react'
import './App.css'

type Region = {
  id: string
  label: string
  bounds: {
    lamin: number
    lomin: number
    lamax: number
    lomax: number
  }
}

type Airport = {
  code: string
  name: string
  city: string
  lat: number
  lon: number
}

type OpenSkyState = [
  string,
  string | null,
  string | null,
  number | null,
  number | null,
  number | null,
  number | null,
  boolean,
  number | null,
  number | null,
  number | null,
  number[] | null,
  number | null,
  string | null,
  boolean,
  number,
]

type Candidate = {
  icao24: string
  callsign: string
  originCountry: string
  lat: number
  lon: number
  altitude: number
  velocity: number
  heading: number
  verticalRate: number
  airport: Airport
  projectedLat: number
  projectedLon: number
  distanceToAirportKm: number
  score: number
  lastContact: number
}

type SessionType = 'work' | 'shortBreak' | 'longBreak'

type Position = {
  lat: number
  lon: number
}

type StoredSession = {
  selectedCandidate: Candidate
  targetTime: number
  durationMinutes: number
  startedAt?: number
  activeDurationMinutes?: number
  sessionType?: SessionType
  completedPomodoros?: number
}

const shortBreakMinutes = 5
const longBreakMinutes = 15
const longBreakInterval = 4
const openSkyCooldownMs = 10_000
const openSkyTimeoutMs = 12_000
const openSkyApiBase = import.meta.env.DEV ? '/api/opensky' : 'https://opensky-network.org/api'

const regions: Region[] = [
  {
    id: 'japan',
    label: 'Japan / East Asia',
    bounds: { lamin: 24, lomin: 122, lamax: 46, lomax: 146 },
  },
  {
    id: 'europe',
    label: 'Europe',
    bounds: { lamin: 35, lomin: -12, lamax: 62, lomax: 32 },
  },
  {
    id: 'us-west',
    label: 'US West',
    bounds: { lamin: 30, lomin: -126, lamax: 50, lomax: -108 },
  },
  {
    id: 'us-east',
    label: 'US East',
    bounds: { lamin: 25, lomin: -84, lamax: 47, lomax: -66 },
  },
]

const airports: Airport[] = [
  { code: 'HND', name: 'Tokyo Haneda', city: 'Tokyo', lat: 35.5494, lon: 139.7798 },
  { code: 'NRT', name: 'Narita', city: 'Tokyo', lat: 35.772, lon: 140.3929 },
  { code: 'KIX', name: 'Kansai', city: 'Osaka', lat: 34.4347, lon: 135.244 },
  { code: 'ITM', name: 'Itami', city: 'Osaka', lat: 34.7855, lon: 135.4382 },
  { code: 'CTS', name: 'New Chitose', city: 'Sapporo', lat: 42.7752, lon: 141.6923 },
  { code: 'FUK', name: 'Fukuoka', city: 'Fukuoka', lat: 33.5859, lon: 130.4507 },
  { code: 'OKA', name: 'Naha', city: 'Okinawa', lat: 26.1958, lon: 127.6459 },
  { code: 'ICN', name: 'Incheon', city: 'Seoul', lat: 37.4602, lon: 126.4407 },
  { code: 'GMP', name: 'Gimpo', city: 'Seoul', lat: 37.5583, lon: 126.7906 },
  { code: 'TPE', name: 'Taoyuan', city: 'Taipei', lat: 25.0797, lon: 121.2342 },
  { code: 'LHR', name: 'Heathrow', city: 'London', lat: 51.47, lon: -0.4543 },
  { code: 'LGW', name: 'Gatwick', city: 'London', lat: 51.1537, lon: -0.1821 },
  { code: 'CDG', name: 'Charles de Gaulle', city: 'Paris', lat: 49.0097, lon: 2.5479 },
  { code: 'ORY', name: 'Orly', city: 'Paris', lat: 48.7233, lon: 2.3794 },
  { code: 'AMS', name: 'Schiphol', city: 'Amsterdam', lat: 52.3105, lon: 4.7683 },
  { code: 'FRA', name: 'Frankfurt', city: 'Frankfurt', lat: 50.0379, lon: 8.5622 },
  { code: 'MUC', name: 'Munich', city: 'Munich', lat: 48.3538, lon: 11.7861 },
  { code: 'MAD', name: 'Barajas', city: 'Madrid', lat: 40.4983, lon: -3.5676 },
  { code: 'BCN', name: 'El Prat', city: 'Barcelona', lat: 41.2974, lon: 2.0833 },
  { code: 'FCO', name: 'Fiumicino', city: 'Rome', lat: 41.8003, lon: 12.2389 },
  { code: 'ZRH', name: 'Zurich', city: 'Zurich', lat: 47.4581, lon: 8.5555 },
  { code: 'JFK', name: 'John F. Kennedy', city: 'New York', lat: 40.6413, lon: -73.7781 },
  { code: 'EWR', name: 'Newark', city: 'New York', lat: 40.6895, lon: -74.1745 },
  { code: 'BOS', name: 'Logan', city: 'Boston', lat: 42.3656, lon: -71.0096 },
  { code: 'MIA', name: 'Miami', city: 'Miami', lat: 25.7959, lon: -80.287 },
  { code: 'ORD', name: "O'Hare", city: 'Chicago', lat: 41.9742, lon: -87.9073 },
  { code: 'ATL', name: 'Hartsfield-Jackson', city: 'Atlanta', lat: 33.6407, lon: -84.4277 },
  { code: 'LAX', name: 'Los Angeles', city: 'Los Angeles', lat: 33.9416, lon: -118.4085 },
  { code: 'SFO', name: 'San Francisco', city: 'San Francisco', lat: 37.6213, lon: -122.379 },
  { code: 'SEA', name: 'Seattle-Tacoma', city: 'Seattle', lat: 47.4502, lon: -122.3088 },
  { code: 'LAS', name: 'Harry Reid', city: 'Las Vegas', lat: 36.084, lon: -115.1537 },
  { code: 'DEN', name: 'Denver', city: 'Denver', lat: 39.8561, lon: -104.6737 },
]

const createDemoCandidates = (): Candidate[] => {
  const currentContactTime = Math.floor(new Date().getTime() / 1000)

  return [
    {
      icao24: 'demo001',
      callsign: 'SKY402',
      originCountry: 'Japan',
      lat: 34.64,
      lon: 138.12,
      altitude: 8100,
      velocity: 226,
      heading: 64,
      verticalRate: -2.4,
      airport: airports[0],
      projectedLat: 35.52,
      projectedLon: 139.64,
      distanceToAirportKm: 15,
      score: 15,
      lastContact: currentContactTime,
    },
    {
      icao24: 'demo002',
      callsign: 'FOCUS18',
      originCountry: 'United Kingdom',
      lat: 50.36,
      lon: 1.12,
      altitude: 6900,
      velocity: 210,
      heading: 292,
      verticalRate: -1.2,
      airport: airports[10],
      projectedLat: 51.36,
      projectedLon: -0.31,
      distanceToAirportKm: 18,
      score: 18,
      lastContact: currentContactTime,
    },
  ]
}

const loadStoredSession = (): StoredSession | null => {
  const savedSession = window.localStorage.getItem('flight-focus-session')
  if (!savedSession) {
    return null
  }

  try {
    const parsedSession = JSON.parse(savedSession) as StoredSession

    if (parsedSession.targetTime > new Date().getTime()) {
      return parsedSession
    }
  } catch {
    window.localStorage.removeItem('flight-focus-session')
  }

  return null
}

const formatDuration = (totalSeconds: number) => {
  const clampedSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(clampedSeconds / 3600)
  const minutes = Math.floor((clampedSeconds % 3600) / 60)
  const seconds = clampedSeconds % 60

  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':')
}

const getSessionDurationMinutes = (sessionType: SessionType, workMinutes: number) => {
  if (sessionType === 'shortBreak') {
    return shortBreakMinutes
  }

  if (sessionType === 'longBreak') {
    return longBreakMinutes
  }

  return workMinutes
}

const getSessionLabel = (sessionType: SessionType) => {
  if (sessionType === 'shortBreak') {
    return 'Short break'
  }

  if (sessionType === 'longBreak') {
    return 'Long break'
  }

  return 'Focus'
}

const getNextSessionLabel = (sessionType: SessionType, completedPomodoros: number) => {
  if (sessionType !== 'work') {
    return 'Next: Focus'
  }

  return (completedPomodoros + 1) % longBreakInterval === 0 ? 'Next: Long break' : 'Next: Short break'
}

const getFlightPosition = (candidate: Candidate, progressRatio: number): Position => {
  const clampedRatio = Math.min(1, Math.max(0, progressRatio))

  return {
    lat: candidate.lat + (candidate.projectedLat - candidate.lat) * clampedRatio,
    lon: candidate.lon + (candidate.projectedLon - candidate.lon) * clampedRatio,
  }
}

const getOpenSkyErrorMessage = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'OpenSkyの応答が遅いため、少し待って再試行してください。'
  }

  if (!(error instanceof Error)) {
    return 'OpenSkyに接続できませんでした。'
  }

  if (error.message.includes('429')) {
    return 'OpenSkyの利用制限に達しました。10秒ほど待ってから再試行してください。'
  }

  if (error.message.includes('401') || error.message.includes('403')) {
    return 'OpenSkyが匿名アクセスを制限しています。時間を置くか、認証付き接続が必要です。'
  }

  if (error.message.includes('Failed to fetch')) {
    return 'OpenSkyへのブラウザ接続がブロックされました。開発サーバーを再起動してプロキシ経由で試してください。'
  }

  return `OpenSky接続エラー: ${error.message}`
}

const sendCompletionNotification = (sessionType: SessionType) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return
  }

  new Notification('Flight Focus Timer', {
    body:
      sessionType === 'work'
        ? '集中時間が終わりました。休憩に進みます。'
        : '休憩が終わりました。次の集中へ進めます。',
  })
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180
const toDegrees = (radians: number) => (radians * 180) / Math.PI

const distanceKm = (startLat: number, startLon: number, endLat: number, endLon: number) => {
  const earthRadiusKm = 6371
  const deltaLat = toRadians(endLat - startLat)
  const deltaLon = toRadians(endLon - startLon)
  const startLatRad = toRadians(startLat)
  const endLatRad = toRadians(endLat)
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLatRad) * Math.cos(endLatRad) * Math.sin(deltaLon / 2) ** 2

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

const projectPosition = (lat: number, lon: number, heading: number, distanceInKm: number) => {
  const earthRadiusKm = 6371
  const angularDistance = distanceInKm / earthRadiusKm
  const bearing = toRadians(heading)
  const latRad = toRadians(lat)
  const lonRad = toRadians(lon)

  const projectedLat = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing),
  )
  const projectedLon =
    lonRad +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(projectedLat),
    )

  return {
    lat: toDegrees(projectedLat),
    lon: ((toDegrees(projectedLon) + 540) % 360) - 180,
  }
}

const findCandidates = (states: OpenSkyState[], durationMinutes: number): Candidate[] => {
  const targetSeconds = durationMinutes * 60
  const targetDistanceKm = 0

  return states
    .map((state): Candidate | null => {
      const [icao24, callsign, originCountry, , lastContact, lon, lat, onGround, velocity, heading, verticalRate, , altitude] = state

      if (
        !icao24 ||
        lat === null ||
        lon === null ||
        velocity === null ||
        heading === null ||
        altitude === null ||
        onGround ||
        velocity < 80
      ) {
        return null
      }

      const projectedDistanceKm = (velocity * targetSeconds) / 1000
      const projected = projectPosition(lat, lon, heading, projectedDistanceKm)
      const nearestAirport = airports
        .map((airport) => ({
          airport,
          distance: distanceKm(projected.lat, projected.lon, airport.lat, airport.lon),
        }))
        .sort((first, second) => first.distance - second.distance)[0]

      if (!nearestAirport || nearestAirport.distance > 160) {
        return null
      }

      const descentBonus = verticalRate !== null && verticalRate < 0 ? Math.min(Math.abs(verticalRate) * 3, 15) : 0
      const altitudePenalty = Math.max(0, altitude - 9000) / 800
      const score = nearestAirport.distance + altitudePenalty - descentBonus + targetDistanceKm

      return {
        icao24,
        callsign: callsign?.trim() || icao24.toUpperCase(),
        originCountry: originCountry || 'Unknown',
        lat,
        lon,
        altitude,
        velocity,
        heading,
        verticalRate: verticalRate ?? 0,
        airport: nearestAirport.airport,
        projectedLat: projected.lat,
        projectedLon: projected.lon,
        distanceToAirportKm: nearestAirport.distance,
        score,
        lastContact: lastContact ?? Math.floor(Date.now() / 1000),
      }
    })
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort((first, second) => first.score - second.score)
    .slice(0, 8)
}

const createPlaneIcon = () =>
  L.divIcon({
    className: 'plane-marker',
    html: '<span>✈</span>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })

const createAirportIcon = () =>
  L.divIcon({
    className: 'airport-marker',
    html: '<span></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })

function App() {
  const [restoredSession] = useState<StoredSession | null>(() => loadStoredSession())
  const [durationMinutes, setDurationMinutes] = useState(restoredSession?.durationMinutes ?? 45)
  const [regionId, setRegionId] = useState(regions[0].id)
  const [candidates, setCandidates] = useState<Candidate[]>(
    restoredSession ? [restoredSession.selectedCandidate] : [],
  )
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(
    restoredSession?.selectedCandidate ?? null,
  )
  const [sessionType, setSessionType] = useState<SessionType>(restoredSession?.sessionType ?? 'work')
  const [completedPomodoros, setCompletedPomodoros] = useState(restoredSession?.completedPomodoros ?? 0)
  const [startedAt, setStartedAt] = useState<number | null>(
    restoredSession?.startedAt ??
      (restoredSession
        ? restoredSession.targetTime -
          (restoredSession.activeDurationMinutes ?? restoredSession.durationMinutes) * 60 * 1000
        : null),
  )
  const [activeDurationMinutes, setActiveDurationMinutes] = useState(
    restoredSession?.activeDurationMinutes ?? restoredSession?.durationMinutes ?? 45,
  )
  const [targetTime, setTargetTime] = useState<number | null>(restoredSession?.targetTime ?? null)
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    restoredSession ? Math.max(0, Math.ceil((restoredSession.targetTime - Date.now()) / 1000)) : 0,
  )
  const [currentPosition, setCurrentPosition] = useState<Position | null>(() => {
    if (!restoredSession) {
      return null
    }

    const sessionStartedAt =
      restoredSession.startedAt ??
      restoredSession.targetTime -
        (restoredSession.activeDurationMinutes ?? restoredSession.durationMinutes) * 60 * 1000
    const sessionDurationMs =
      (restoredSession.activeDurationMinutes ?? restoredSession.durationMinutes) * 60 * 1000
    const progressRatio = sessionDurationMs > 0 ? (Date.now() - sessionStartedAt) / sessionDurationMs : 0
    return getFlightPosition(restoredSession.selectedCandidate, progressRatio)
  })
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState(
    restoredSession
      ? '前回のフライトタイマーを復元しました。'
      : '時間を決めて、同じ頃に着きそうな便を探せます。',
  )
  const [usingDemoData, setUsingDemoData] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<L.LayerGroup | null>(null)
  const focusedCandidateRef = useRef<string | null>(null)
  const completedTargetRef = useRef<number | null>(null)
  const lastOpenSkySearchRef = useRef<number | null>(null)

  const selectedRegion = useMemo(
    () => regions.find((region) => region.id === regionId) ?? regions[0],
    [regionId],
  )

  const progress = useMemo(() => {
    if (!targetTime || !selectedCandidate) {
      return 0
    }

    const totalSeconds = activeDurationMinutes * 60
    return Math.min(100, Math.max(0, ((totalSeconds - remainingSeconds) / totalSeconds) * 100))
  }, [activeDurationMinutes, remainingSeconds, selectedCandidate, targetTime])

  const plannedDurationMinutes = getSessionDurationMinutes(sessionType, durationMinutes)

  const completeCurrentSession = useCallback(() => {
    if (!selectedCandidate) {
      return
    }

    setCurrentPosition(getFlightPosition(selectedCandidate, 1))
    setTargetTime(null)
    setStartedAt(null)
    setRemainingSeconds(0)
    sendCompletionNotification(sessionType)
    window.localStorage.removeItem('flight-focus-session')

    if (sessionType === 'work') {
      const nextCompletedPomodoros = completedPomodoros + 1
      const nextSessionType: SessionType =
        nextCompletedPomodoros % longBreakInterval === 0 ? 'longBreak' : 'shortBreak'
      setCompletedPomodoros(nextCompletedPomodoros)
      setSessionType(nextSessionType)
      setActiveDurationMinutes(getSessionDurationMinutes(nextSessionType, durationMinutes))
      setStatus(
        nextSessionType === 'longBreak'
          ? '集中完了。次は長めの休憩です。'
          : '集中完了。次は短い休憩です。',
      )
      return
    }

    setSessionType('work')
    setActiveDurationMinutes(durationMinutes)
    setStatus('休憩完了。次の集中フライトを探せます。')
  }, [completedPomodoros, durationMinutes, selectedCandidate, sessionType])

  useEffect(() => {
    if (!targetTime || !startedAt || !selectedCandidate) {
      return
    }

    const updateRemaining = () => {
      const nextRemainingSeconds = Math.max(0, Math.ceil((targetTime - Date.now()) / 1000))
      const sessionDurationMs = activeDurationMinutes * 60 * 1000
      const progressRatio = sessionDurationMs > 0 ? (Date.now() - startedAt) / sessionDurationMs : 1
      setRemainingSeconds(nextRemainingSeconds)
      setCurrentPosition(getFlightPosition(selectedCandidate, progressRatio))

      if (nextRemainingSeconds === 0 && completedTargetRef.current !== targetTime) {
        completedTargetRef.current = targetTime
        completeCurrentSession()
      }
    }

    updateRemaining()
    const intervalId = window.setInterval(updateRemaining, 1000)
    return () => window.clearInterval(intervalId)
  }, [activeDurationMinutes, completeCurrentSession, selectedCandidate, startedAt, targetTime])

  useEffect(() => {
    if (!selectedCandidate || !targetTime) {
      return
    }

    window.localStorage.setItem(
      'flight-focus-session',
      JSON.stringify({
        selectedCandidate,
        targetTime,
        durationMinutes,
        startedAt,
        activeDurationMinutes,
        sessionType,
        completedPomodoros,
      }),
    )
  }, [activeDurationMinutes, completedPomodoros, durationMinutes, selectedCandidate, sessionType, startedAt, targetTime])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return
    }

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([35.7, 139.7], 5)

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.control
      .attribution({ position: 'bottomleft', prefix: false })
      .addAttribution('Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community')
      .addTo(map)

    const layers = L.layerGroup().addTo(map)
    mapRef.current = map
    layersRef.current = layers
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layers = layersRef.current
    if (!map || !layers) {
      return
    }

    layers.clearLayers()

    const candidate = selectedCandidate ?? candidates[0]
    if (!candidate) {
      map.setView([35.7, 139.7], 4)
      focusedCandidateRef.current = null
      return
    }

    const position = selectedCandidate && currentPosition ? currentPosition : { lat: candidate.lat, lon: candidate.lon }

    const planeIcon = createPlaneIcon()
    const airportIcon = createAirportIcon()
    L.marker([position.lat, position.lon], { icon: planeIcon, rotationAngle: candidate.heading } as L.MarkerOptions)
      .bindPopup(`${candidate.callsign} / ${candidate.originCountry}`)
      .addTo(layers)
    L.marker([candidate.airport.lat, candidate.airport.lon], { icon: airportIcon })
      .bindPopup(`${candidate.airport.code} ${candidate.airport.name}`)
      .addTo(layers)
    L.polyline(
      [
        [position.lat, position.lon],
        [candidate.airport.lat, candidate.airport.lon],
      ],
      { color: '#ffffff', weight: 3, opacity: 0.9, dashArray: '8 8' },
    ).addTo(layers)

    const focusKey = `${candidate.icao24}-${candidate.airport.code}`
    if (focusedCandidateRef.current !== focusKey) {
      const bounds = L.latLngBounds([
        [position.lat, position.lon],
        [candidate.airport.lat, candidate.airport.lon],
      ])
      map.fitBounds(bounds.pad(0.35), { animate: true, maxZoom: 8 })
      focusedCandidateRef.current = focusKey
    }
  }, [candidates, currentPosition, selectedCandidate])

  const searchFlights = async () => {
    const now = new Date().getTime()
    const elapsedSinceLastSearch = lastOpenSkySearchRef.current ? now - lastOpenSkySearchRef.current : openSkyCooldownMs

    if (elapsedSinceLastSearch < openSkyCooldownMs) {
      const retrySeconds = Math.ceil((openSkyCooldownMs - elapsedSinceLastSearch) / 1000)
      setStatus(`OpenSkyの制限を避けるため、あと${retrySeconds}秒待ってから再試行してください。`)
      return
    }

    setIsLoading(true)
    setUsingDemoData(false)
    lastOpenSkySearchRef.current = now
    if (!targetTime) {
      setSelectedCandidate(null)
      setCurrentPosition(null)
      focusedCandidateRef.current = null
    }
    setStatus('OpenSky Networkからライブ航空機データを取得しています。')

    const params = new URLSearchParams(
      Object.entries(selectedRegion.bounds).map(([key, value]) => [key, value.toString()]),
    )

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), openSkyTimeoutMs)

    try {
      const response = await fetch(`${openSkyApiBase}/states/all?${params.toString()}`, {
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`OpenSky responded with ${response.status} ${response.statusText}`)
      }

      const data = (await response.json()) as { states?: OpenSkyState[]; time?: number }
      const nextCandidates = findCandidates(data.states ?? [], plannedDurationMinutes)
      setCandidates(nextCandidates)
      const responseTime = data.time ? data.time * 1000 : new Date().getTime()
      setLastUpdated(new Date(responseTime))

      if (nextCandidates.length === 0) {
        setStatus('条件に近い便が見つかりませんでした。地域を変えるか、時間を少し長めにしてください。')
      } else {
        setStatus(`${nextCandidates.length}件の候補を見つけました。`)
      }
    } catch (error) {
      setCandidates(createDemoCandidates())
      setUsingDemoData(true)
      setLastUpdated(new Date())
      setStatus(`${getOpenSkyErrorMessage(error)} デモ便で画面を確認できます。`)
    } finally {
      window.clearTimeout(timeoutId)
      setIsLoading(false)
    }
  }

  const startSession = (candidate: Candidate) => {
    const nextDurationMinutes = getSessionDurationMinutes(sessionType, durationMinutes)
    const nextStartedAt = new Date().getTime()
    const nextTargetTime = nextStartedAt + nextDurationMinutes * 60 * 1000
    setSelectedCandidate(candidate)
    setStartedAt(nextStartedAt)
    setActiveDurationMinutes(nextDurationMinutes)
    setTargetTime(nextTargetTime)
    setRemainingSeconds(nextDurationMinutes * 60)
    setCurrentPosition({ lat: candidate.lat, lon: candidate.lon })
    completedTargetRef.current = null
    setStatus(`${getSessionLabel(sessionType)}: ${candidate.callsign} と ${candidate.airport.city} へ。`)
  }

  const stopSession = () => {
    setSelectedCandidate(null)
    setTargetTime(null)
    setStartedAt(null)
    setRemainingSeconds(0)
    setCurrentPosition(null)
    setSessionType('work')
    setCompletedPomodoros(0)
    setActiveDurationMinutes(durationMinutes)
    completedTargetRef.current = null
    window.localStorage.removeItem('flight-focus-session')
    setStatus('セッションを停止しました。次のフライトを探せます。')
  }

  const enableNotifications = async () => {
    if (!('Notification' in window)) {
      setStatus('このブラウザは通知に対応していません。')
      return
    }

    const permission = await Notification.requestPermission()
    setStatus(permission === 'granted' ? '到着通知を有効にしました。' : '通知は許可されませんでした。')
  }

  return (
    <main className="app-shell">
      <section className="control-panel" aria-label="Flight focus timer controls">
        <header className="brand-row">
          <p className="eyebrow">Flight Focus</p>
          <h1>到着まで集中する。</h1>
        </header>

        <div className="timer-block">
          <div className="timer-label">
            <Clock size={18} aria-hidden="true" />
            {getSessionLabel(sessionType)}
          </div>
          <div className="timer-value">
            {targetTime ? formatDuration(remainingSeconds) : formatDuration(plannedDurationMinutes * 60)}
          </div>
          <div className="timer-meta">
            <span>{selectedCandidate ? `${selectedCandidate.callsign} to ${selectedCandidate.airport.code}` : 'Ready'}</span>
            <span>{completedPomodoros % longBreakInterval}/{longBreakInterval}</span>
            <span>{getNextSessionLabel(sessionType, completedPomodoros)}</span>
          </div>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="search-grid">
          <label>
            作業時間
            <div className="input-with-unit">
              <input
                min="15"
                max="240"
                step="5"
                type="number"
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(Number(event.target.value))}
              />
              <span>min</span>
            </div>
          </label>
          <label>
            探す地域
            <select value={regionId} onChange={(event) => setRegionId(event.target.value)}>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="action-row">
          <button type="button" className="primary-button" onClick={searchFlights} disabled={isLoading}>
            {isLoading ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
            便を探す
          </button>
          <button type="button" className="icon-button" onClick={enableNotifications} title="到着通知を有効にする">
            <Bell size={18} aria-hidden="true" />
          </button>
          {selectedCandidate && (
            <button type="button" className="secondary-button" onClick={stopSession}>
              停止
            </button>
          )}
        </div>

        <p className="status-line">{status}</p>

        <div className="candidate-list" aria-label="Flight candidates">
          {candidates.map((candidate) => (
            <button
              type="button"
              className={`candidate-card ${selectedCandidate?.icao24 === candidate.icao24 ? 'is-selected' : ''}`}
              key={candidate.icao24}
              onClick={() => startSession(candidate)}
            >
              <span className="candidate-main">
                <strong>{candidate.callsign}</strong>
                <span>{candidate.originCountry}</span>
              </span>
              <span className="candidate-destination">
                <MapPin size={15} aria-hidden="true" />
                {candidate.airport.city} / {candidate.airport.code}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="map-panel" aria-label="Flight map">
        <div className="map-toolbar">
          <div>
            <p className="eyebrow">Live map</p>
            <h2>{selectedCandidate ? selectedCandidate.airport.name : 'Select a flight'}</h2>
          </div>
          <div className="map-meta">
            <span className={usingDemoData ? 'source-pill demo' : 'source-pill'}>{usingDemoData ? 'Demo' : 'OpenSky free'}</span>
            <span>
              <RefreshCw size={14} aria-hidden="true" />
              {lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
            </span>
          </div>
        </div>
        <div ref={mapContainerRef} className="flight-map" />
      </section>
    </main>
  )
}

export default App
