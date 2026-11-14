import { Title1 } from "@fluentui/react-components";
import notices from "./notices.json";

export default function NoticesPage() {
  return (
    <section className="notices-page" aria-label="Open source notices">
      <Title1 as="h1">Notices</Title1>
      <ul className="notices-list">
        {notices.attributions.map((item) => (
          <li key={item.name}>
            <div className="notice-heading">
              <a href={item.url}>{item.name}</a>
            </div>
            <p>{item.attribution}</p>
            <a href={item.licenseUrl}>{item.license}</a>
          </li>
        ))}
      </ul>
      <a href="/notices/software-licenses.txt">Third-party software licenses</a>
    </section>
  );
}
