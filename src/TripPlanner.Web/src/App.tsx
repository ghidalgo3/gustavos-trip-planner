import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  LargeTitle,
  Spinner,
  Subtitle1,
  Text,
  Title3,
} from "@fluentui/react-components";
import {
  CalendarLtr24Regular,
  Location24Regular,
  SignOut24Regular,
} from "@fluentui/react-icons";
import { getCurrentUser, loginUrl, logoutUrl, type CurrentUser } from "./api";

export default function App() {
  const [user, setUser] = useState<CurrentUser>();
  const [apiAvailable, setApiAvailable] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    getCurrentUser(controller.signal)
      .then(setUser)
      .catch(() => setApiAvailable(false));
    return () => controller.abort();
  }, []);

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <Location24Regular />
          <Text weight="semibold" size={400}>Trip Planner</Text>
        </div>
        {user?.isAuthenticated && (
          <Button as="a" href={logoutUrl()} appearance="subtle" icon={<SignOut24Regular />}>
            Sign out
          </Button>
        )}
      </header>

      <section className="hero">
        <div className="hero-copy">
          <Text className="eyebrow" weight="semibold">YOUR NEXT STORY STARTS HERE</Text>
          <LargeTitle>Make room for the trip, not the busywork.</LargeTitle>
          <Subtitle1>
            Keep destinations, dates, and ideas together in one calm place.
          </Subtitle1>

          {!apiAvailable ? (
            <Text role="alert">The API is not available yet. Start the local containers and refresh.</Text>
          ) : !user ? (
            <Spinner label="Checking your session" />
          ) : user.isAuthenticated ? (
            <div className="welcome">
              <Title3>Welcome back, {user.name ?? user.email ?? "traveler"}.</Title3>
              <Button appearance="primary" size="large" icon={<CalendarLtr24Regular />}>
                Plan a trip
              </Button>
            </div>
          ) : (
            <div className="auth-actions" aria-label="Sign in options">
              <Button as="a" href={loginUrl("google")} appearance="primary" size="large">
                Continue with Google
              </Button>
              <Button as="a" href={loginUrl("apple")} appearance="outline" size="large">
                Continue with Apple
              </Button>
            </div>
          )}
        </div>

        <Card className="postcard" appearance="filled-alternative">
          <CardHeader
            image={<div className="postcard-icon"><Location24Regular /></div>}
            header={<Title3>Everything in one itinerary</Title3>}
            description={<Text>Dates, notes, and destinations are ready when inspiration strikes.</Text>}
          />
          <div className="route" aria-hidden="true">
            <span>Home</span><span className="route-line" /><span>Somewhere wonderful</span>
          </div>
        </Card>
      </section>
    </main>
  );
}
