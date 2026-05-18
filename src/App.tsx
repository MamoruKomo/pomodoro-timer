import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import {
  Bell,
  Clock,
  Loader2,
  MapPin,
  Plane,
  RefreshCw,
  Search,
} from 'lucide-react'
import './App.css'

type Airport = {
  code: string
  name: string
  city: string
  lat: number
  lon: number
}

type AdsbAircraft = {
  hex?: string
  flight?: string
  alt_baro?: number | 'ground'
  alt_geom?: number
  gs?: number
  track?: number
  baro_rate?: number
  geom_rate?: number
  lat?: number
  lon?: number
  seen?: number
}

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

type MotionPlan = {
  from: Position
  to: Position
  startedAt: number
  endsAt: number
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
const aircraftSearchCooldownMs = 10_000
const aircraftSearchTimeoutMs = 18_000
const adsbSearchRadiusNm = 250
const flightPositionUpdateMs = 250
const aircraftPositionRefreshMs = 180_000
const routeFitMaxZoom = 8
const preferredAirportDistanceKm = 180
const fallbackAirportDistanceKm = 850
const aircraftApiBase = import.meta.env.DEV ? '/api/airplanes' : 'https://api.airplanes.live'

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

const searchAirports = airports

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

const interpolatePosition = (from: Position, to: Position, progressRatio: number): Position => {
  const clampedRatio = Math.min(1, Math.max(0, progressRatio))

  return {
    lat: from.lat + (to.lat - from.lat) * clampedRatio,
    lon: from.lon + (to.lon - from.lon) * clampedRatio,
  }
}

const createMotionPlan = (
  candidate: Candidate,
  from: Position,
  startedAt: number,
  targetTime: number | null,
): MotionPlan => {
  const remainingMs = targetTime ? Math.max(0, targetTime - startedAt) : aircraftPositionRefreshMs
  const motionDurationMs = Math.max(flightPositionUpdateMs, Math.min(aircraftPositionRefreshMs, remainingMs))
  const projectedDistanceKm = (candidate.velocity * motionDurationMs) / 1000
  const projected = projectPosition(candidate.lat, candidate.lon, candidate.heading, projectedDistanceKm)

  return {
    from,
    to: { lat: projected.lat, lon: projected.lon },
    startedAt,
    endsAt: startedAt + motionDurationMs,
  }
}

const getAircraftSearchErrorMessage = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '航空機データの応答が遅いため、少し待って再試行してください。'
  }

  if (!(error instanceof Error)) {
    return '航空機データに接続できませんでした。'
  }

  if (error.message.includes('429')) {
    return '航空機データの利用制限に達しました。10秒ほど待ってから再試行してください。'
  }

  if (error.message.includes('401') || error.message.includes('403')) {
    return '航空機データの匿名アクセスが制限されています。時間を置いて再試行してください。'
  }

  if (error.message.includes('Failed to fetch')) {
    return '航空機データへのブラウザ接続がブロックされました。開発サーバーを再起動してプロキシ経由で試してください。'
  }

  return `航空機データ接続エラー: ${error.message}`
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

const findCandidates = (aircraftList: AdsbAircraft[], durationMinutes: number): Candidate[] => {
  const targetSeconds = durationMinutes * 60
  const targetDistanceKm = 0
  const seenAircraft = new Set<string>()

  const rankedCandidates = aircraftList
    .map((aircraft): Candidate | null => {
      const icao24 = aircraft.hex
      const callsign = aircraft.flight?.trim()
      const lat = aircraft.lat
      const lon = aircraft.lon
      const groundSpeedKnots = aircraft.gs
      const heading = aircraft.track
      const altitudeFeet = aircraft.alt_geom ?? (typeof aircraft.alt_baro === 'number' ? aircraft.alt_baro : null)
      const verticalRateFeetPerMinute = aircraft.geom_rate ?? aircraft.baro_rate ?? 0

      if (
        !icao24 ||
        seenAircraft.has(icao24) ||
        lat === undefined ||
        lon === undefined ||
        groundSpeedKnots === undefined ||
        heading === undefined ||
        altitudeFeet === null ||
        aircraft.alt_baro === 'ground'
      ) {
        return null
      }

      seenAircraft.add(icao24)

      const velocity = groundSpeedKnots * 0.514444
      const altitude = altitudeFeet * 0.3048
      const verticalRate = verticalRateFeetPerMinute / 196.85

      if (
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

      if (!nearestAirport || nearestAirport.distance > fallbackAirportDistanceKm) {
        return null
      }

      const descentBonus = verticalRate !== null && verticalRate < 0 ? Math.min(Math.abs(verticalRate) * 3, 15) : 0
      const altitudePenalty = Math.max(0, altitude - 9000) / 800
      const score = nearestAirport.distance + altitudePenalty - descentBonus + targetDistanceKm

      return {
        icao24,
        callsign: callsign || icao24.toUpperCase(),
        originCountry: 'ADS-B live',
        lat,
        lon,
        altitude,
        velocity,
        heading,
        verticalRate,
        airport: nearestAirport.airport,
        projectedLat: projected.lat,
        projectedLon: projected.lon,
        distanceToAirportKm: nearestAirport.distance,
        score,
        lastContact: Math.floor((new Date().getTime() - (aircraft.seen ?? 0) * 1000) / 1000),
      }
    })
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort((first, second) => first.score - second.score)

  const preferredCandidates = rankedCandidates.filter(
    (candidate) => candidate.distanceToAirportKm <= preferredAirportDistanceKm,
  )

  return (preferredCandidates.length > 0 ? preferredCandidates : rankedCandidates)
    .slice(0, 6)
}

const updateCandidateFromAircraft = (
  candidate: Candidate,
  aircraft: AdsbAircraft,
  targetTime: number | null,
): Candidate | null => {
  const lat = aircraft.lat
  const lon = aircraft.lon
  const groundSpeedKnots = aircraft.gs
  const heading = aircraft.track
  const altitudeFeet = aircraft.alt_geom ?? (typeof aircraft.alt_baro === 'number' ? aircraft.alt_baro : null)
  const verticalRateFeetPerMinute = aircraft.geom_rate ?? aircraft.baro_rate ?? 0

  if (
    lat === undefined ||
    lon === undefined ||
    groundSpeedKnots === undefined ||
    heading === undefined ||
    altitudeFeet === null ||
    aircraft.alt_baro === 'ground'
  ) {
    return null
  }

  const velocity = groundSpeedKnots * 0.514444
  const altitude = altitudeFeet * 0.3048
  const verticalRate = verticalRateFeetPerMinute / 196.85
  const remainingSeconds = targetTime ? Math.max(0, (targetTime - new Date().getTime()) / 1000) : 0
  const projectedDistanceKm = (velocity * remainingSeconds) / 1000
  const projected = projectPosition(lat, lon, heading, projectedDistanceKm)
  const distanceToAirportKm = distanceKm(projected.lat, projected.lon, candidate.airport.lat, candidate.airport.lon)

  return {
    ...candidate,
    callsign: aircraft.flight?.trim() || candidate.callsign,
    lat,
    lon,
    altitude,
    velocity,
    heading,
    verticalRate,
    projectedLat: projected.lat,
    projectedLon: projected.lon,
    distanceToAirportKm,
    lastContact: Math.floor((new Date().getTime() - (aircraft.seen ?? 0) * 1000) / 1000),
  }
}

const fetchAircraftAroundAirports = async (signal: AbortSignal) => {
  const responses = await Promise.allSettled(
    searchAirports.map(async (airport) => {
      const response = await fetch(
        `${aircraftApiBase}/v2/point/${airport.lat}/${airport.lon}/${adsbSearchRadiusNm}`,
        { signal },
      )

      if (!response.ok) {
        throw new Error(`airplanes.live responded with ${response.status} ${response.statusText}`)
      }

      return (await response.json()) as { ac?: AdsbAircraft[]; now?: number; total?: number }
    }),
  )

  const aircraftList = responses.flatMap((response) =>
    response.status === 'fulfilled' ? response.value.ac ?? [] : [],
  )

  if (aircraftList.length === 0) {
    const failedResponse = responses.find((response) => response.status === 'rejected')
    if (failedResponse?.status === 'rejected') {
      throw failedResponse.reason
    }
  }

  return aircraftList
}

const fetchAircraftByHex = async (icao24: string, signal: AbortSignal) => {
  const response = await fetch(`${aircraftApiBase}/v2/hex/${icao24}`, { signal })

  if (!response.ok) {
    throw new Error(`airplanes.live responded with ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as { ac?: AdsbAircraft[] }
  return data.ac?.[0] ?? null
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
  const planeMarkerRef = useRef<L.Marker | null>(null)
  const airportMarkerRef = useRef<L.Marker | null>(null)
  const routeLineRef = useRef<L.Polyline | null>(null)
  const focusedCandidateRef = useRef<string | null>(null)
  const completedTargetRef = useRef<number | null>(null)
  const lastAircraftSearchRef = useRef<number | null>(null)
  const currentPositionRef = useRef<Position | null>(currentPosition)
  const selectedCandidateRef = useRef<Candidate | null>(selectedCandidate)
  const motionPlanRef = useRef<MotionPlan | null>(null)

  const progress = useMemo(() => {
    if (!targetTime || !selectedCandidate) {
      return 0
    }

    const totalSeconds = activeDurationMinutes * 60
    return Math.min(100, Math.max(0, ((totalSeconds - remainingSeconds) / totalSeconds) * 100))
  }, [activeDurationMinutes, remainingSeconds, selectedCandidate, targetTime])

  const plannedDurationMinutes = getSessionDurationMinutes(sessionType, durationMinutes)
  const selectedAircraftId = selectedCandidate?.icao24

  useEffect(() => {
    currentPositionRef.current = currentPosition
  }, [currentPosition])

  useEffect(() => {
    selectedCandidateRef.current = selectedCandidate
  }, [selectedCandidate])

  const completeCurrentSession = useCallback(() => {
    if (!selectedCandidate) {
      return
    }

    setCurrentPosition(getFlightPosition(selectedCandidate, 1))
    currentPositionRef.current = getFlightPosition(selectedCandidate, 1)
    motionPlanRef.current = null
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
      const now = new Date().getTime()
      const nextRemainingSeconds = Math.max(0, Math.ceil((targetTime - now) / 1000))
      setRemainingSeconds(nextRemainingSeconds)

      if (!motionPlanRef.current || now >= motionPlanRef.current.endsAt) {
        const nextFrom = currentPositionRef.current ?? { lat: selectedCandidate.lat, lon: selectedCandidate.lon }
        motionPlanRef.current = createMotionPlan(selectedCandidate, nextFrom, now, targetTime)
      }

      const motionPlan = motionPlanRef.current
      const motionProgress = (now - motionPlan.startedAt) / (motionPlan.endsAt - motionPlan.startedAt)
      const nextPosition = interpolatePosition(motionPlan.from, motionPlan.to, motionProgress)
      currentPositionRef.current = nextPosition
      setCurrentPosition(nextPosition)

      if (nextRemainingSeconds === 0 && completedTargetRef.current !== targetTime) {
        completedTargetRef.current = targetTime
        completeCurrentSession()
      }
    }

    updateRemaining()
    const intervalId = window.setInterval(updateRemaining, flightPositionUpdateMs)
    return () => window.clearInterval(intervalId)
  }, [completeCurrentSession, selectedCandidate, startedAt, targetTime])

  useEffect(() => {
    if (!selectedAircraftId || !targetTime) {
      return
    }

    const controller = new AbortController()

    const refreshAircraftPosition = async () => {
      const activeCandidate = selectedCandidateRef.current
      if (!activeCandidate || !targetTime) {
        return
      }

      try {
        const aircraft = await fetchAircraftByHex(activeCandidate.icao24, controller.signal)
        if (!aircraft) {
          return
        }

        const nextCandidate = updateCandidateFromAircraft(activeCandidate, aircraft, targetTime)
        if (!nextCandidate) {
          return
        }

        const now = new Date().getTime()
        const nextFrom = currentPositionRef.current ?? { lat: nextCandidate.lat, lon: nextCandidate.lon }
        selectedCandidateRef.current = nextCandidate
        motionPlanRef.current = createMotionPlan(nextCandidate, nextFrom, now, targetTime)
        setSelectedCandidate(nextCandidate)
        setCandidates((previousCandidates) =>
          previousCandidates.map((candidate) =>
            candidate.icao24 === nextCandidate.icao24 ? nextCandidate : candidate,
          ),
        )
        setLastUpdated(new Date())
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setStatus(getAircraftSearchErrorMessage(error))
        }
      }
    }

    const intervalId = window.setInterval(refreshAircraftPosition, aircraftPositionRefreshMs)
    return () => {
      controller.abort()
      window.clearInterval(intervalId)
    }
  }, [selectedAircraftId, targetTime])

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
      maxZoom: 19,
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
      layers.clearLayers()
      planeMarkerRef.current = null
      airportMarkerRef.current = null
      routeLineRef.current = null
      focusedCandidateRef.current = null
      return
    }

    const position = selectedCandidate && currentPosition ? currentPosition : { lat: candidate.lat, lon: candidate.lon }
    const focusKey = `${candidate.icao24}-${candidate.airport.code}`

    if (focusedCandidateRef.current !== focusKey || !planeMarkerRef.current) {
      layers.clearLayers()
      const planeIcon = createPlaneIcon()
      const airportIcon = createAirportIcon()
      planeMarkerRef.current = L.marker([position.lat, position.lon], {
        icon: planeIcon,
        rotationAngle: candidate.heading,
      } as L.MarkerOptions)
        .bindPopup(`${candidate.callsign} / ${candidate.originCountry}`)
        .addTo(layers)
      airportMarkerRef.current = L.marker([candidate.airport.lat, candidate.airport.lon], { icon: airportIcon })
        .bindPopup(`${candidate.airport.code} ${candidate.airport.name}`)
        .addTo(layers)
      routeLineRef.current = L.polyline(
        [
          [position.lat, position.lon],
          [candidate.airport.lat, candidate.airport.lon],
        ],
        { color: '#ffffff', weight: 3, opacity: 0.9, dashArray: '8 8' },
      ).addTo(layers)
    } else {
      planeMarkerRef.current.setLatLng([position.lat, position.lon])
      planeMarkerRef.current.setPopupContent(`${candidate.callsign} / ${candidate.originCountry}`)
      airportMarkerRef.current?.setLatLng([candidate.airport.lat, candidate.airport.lon])
      airportMarkerRef.current?.setPopupContent(`${candidate.airport.code} ${candidate.airport.name}`)
      routeLineRef.current?.setLatLngs([
        [position.lat, position.lon],
        [candidate.airport.lat, candidate.airport.lon],
      ])
    }

    if (targetTime && selectedCandidate && currentPosition) {
      map.panTo([position.lat, position.lon], { animate: true, duration: 0.45, easeLinearity: 0.2 })
      focusedCandidateRef.current = focusKey
    } else if (focusedCandidateRef.current !== focusKey) {
      const bounds = L.latLngBounds([
        [position.lat, position.lon],
        [candidate.airport.lat, candidate.airport.lon],
      ])
      map.fitBounds(bounds.pad(0.35), { animate: true, maxZoom: routeFitMaxZoom })
      focusedCandidateRef.current = focusKey
    }
  }, [candidates, currentPosition, selectedCandidate, targetTime])

  const searchFlights = async () => {
    const now = new Date().getTime()
    const elapsedSinceLastSearch = lastAircraftSearchRef.current ? now - lastAircraftSearchRef.current : aircraftSearchCooldownMs

    if (elapsedSinceLastSearch < aircraftSearchCooldownMs) {
      const retrySeconds = Math.ceil((aircraftSearchCooldownMs - elapsedSinceLastSearch) / 1000)
      setStatus(`航空機データの制限を避けるため、あと${retrySeconds}秒待ってから再試行してください。`)
      return
    }

    setIsLoading(true)
    setUsingDemoData(false)
    lastAircraftSearchRef.current = now
    if (!targetTime) {
      setSelectedCandidate(null)
      setCurrentPosition(null)
      focusedCandidateRef.current = null
    }
    setStatus('airplanes.liveから主要空港周辺のADS-Bデータを取得しています。')

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), aircraftSearchTimeoutMs)

    try {
      const aircraftList = await fetchAircraftAroundAirports(controller.signal)
      const nextCandidates = findCandidates(aircraftList, plannedDurationMinutes)
      setCandidates(nextCandidates)
      setLastUpdated(new Date())

      if (nextCandidates.length === 0) {
        setStatus('条件に近い便が見つかりませんでした。時間を少し長めにして再検索してください。')
      } else if (nextCandidates.every((candidate) => candidate.distanceToAirportKm > preferredAirportDistanceKm)) {
        setStatus('到着予測が近い便を広めに表示しています。時間を変えると候補が入れ替わります。')
      } else {
        setStatus(`${nextCandidates.length}件の候補を見つけました。`)
      }
    } catch (error) {
      setCandidates(createDemoCandidates())
      setUsingDemoData(true)
      setLastUpdated(new Date())
      setStatus(`${getAircraftSearchErrorMessage(error)} デモ便で画面を確認できます。`)
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
    const initialPosition = { lat: candidate.lat, lon: candidate.lon }
    setCurrentPosition(initialPosition)
    currentPositionRef.current = initialPosition
    motionPlanRef.current = createMotionPlan(candidate, initialPosition, nextStartedAt, nextTargetTime)
    completedTargetRef.current = null
    setStatus(`${getSessionLabel(sessionType)}: ${candidate.callsign} と ${candidate.airport.city} へ。`)
  }

  const stopSession = () => {
    setSelectedCandidate(null)
    setTargetTime(null)
    setStartedAt(null)
    setRemainingSeconds(0)
    setCurrentPosition(null)
    currentPositionRef.current = null
    motionPlanRef.current = null
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
          <div className="brand-mark">
            <Plane size={18} aria-hidden="true" />
            FLT-FOCUS
          </div>
          <h1>到着まで集中する。</h1>
          <p className="route-line">
            {selectedCandidate ? `${selectedCandidate.callsign} / ${selectedCandidate.airport.code}` : 'STANDBY / SELECT FLIGHT'}
          </p>
        </header>

        <div className="timer-block">
          <div className="timer-label">
            <Clock size={18} aria-hidden="true" />
            <span>{getSessionLabel(sessionType)}</span>
            <span className="timer-state">{targetTime ? 'IN FLIGHT' : 'ON GROUND'}</span>
          </div>
          <div className="timer-value">
            {targetTime ? formatDuration(remainingSeconds) : formatDuration(plannedDurationMinutes * 60)}
          </div>
          <div className="timer-meta">
            <span>CALLSIGN {selectedCandidate ? selectedCandidate.callsign : 'READY'}</span>
            <span>CYCLE {completedPomodoros % longBreakInterval}/{longBreakInterval}</span>
            <span>{getNextSessionLabel(sessionType, completedPomodoros).toUpperCase()}</span>
          </div>
          <div className="instrument-row" aria-label="Flight instruments">
            <span>
              <strong>HDG</strong>
              {selectedCandidate ? Math.round(selectedCandidate.heading).toString().padStart(3, '0') : '---'}
            </span>
            <span>
              <strong>DEST</strong>
              {selectedCandidate ? selectedCandidate.airport.code : '---'}
            </span>
            <span>
              <strong>ETA</strong>
              {targetTime ? new Date(targetTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
            </span>
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
          <div className="auto-search-panel">
            <span>SEARCH</span>
            <strong>GLOBAL AUTO</strong>
          </div>
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

        <p className="status-line"><span>ATC</span>{status}</p>

        <div className="candidate-list" aria-label="Flight candidates">
          {candidates.map((candidate) => (
            <button
              type="button"
              className={`candidate-card ${selectedCandidate?.icao24 === candidate.icao24 ? 'is-selected' : ''}`}
              key={candidate.icao24}
              onClick={() => startSession(candidate)}
            >
              <span className="flight-strip-code">{candidate.airport.code}</span>
              <span className="candidate-main">
                <strong>{candidate.callsign}</strong>
                <span>{candidate.originCountry}</span>
              </span>
              <span className="candidate-destination">
                <MapPin size={15} aria-hidden="true" />
                {candidate.airport.city} / {candidate.airport.code}
              </span>
              <span className="candidate-route">
                HDG {Math.round(candidate.heading).toString().padStart(3, '0')} / {Math.round(candidate.distanceToAirportKm)} km
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="map-panel" aria-label="Flight map">
        <div className="map-toolbar">
          <div>
            <p className="eyebrow">Satellite nav</p>
            <h2>{selectedCandidate ? selectedCandidate.airport.name : 'Select a flight'}</h2>
          </div>
          <div className="map-meta">
            <span className={usingDemoData ? 'source-pill demo' : 'source-pill'}>{usingDemoData ? 'Demo' : 'ADS-B live'}</span>
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
