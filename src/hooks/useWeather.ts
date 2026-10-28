/* eslint lifepass/no-literal-copy: "error" */
// The Home hero's weather line (iOS `.task { weather = await HomeWeatherService.fetch() }`).
//
// iOS reads it at every Home appear and hides the line until the answer
// lands, and again when a read fails. Home calls `reload()` at every focus;
// the line keeps what it shows while a new read is on the way (iOS keeps it
// too when Home reappears from a pushed page) and takes whatever the read
// answers, null included. Only the latest read lands.
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchWeather, type WeatherSnapshot } from '../services/weather';

export interface WeatherState {
  /** Null while nothing has been read, or when the last read failed: the line is hidden. */
  readonly weather: WeatherSnapshot | null;
  /** Reads the weather again; never throws. */
  readonly reload: () => Promise<void>;
}

export function useWeather(fetcher: typeof fetchWeather = fetchWeather): WeatherState {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const latest = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    const next = await fetcher();
    if (mounted.current && mine === latest.current) setWeather(next);
  }, [fetcher]);

  return { weather, reload };
}
