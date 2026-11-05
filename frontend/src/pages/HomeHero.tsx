import { useFx } from "../fx/useFx";
import { Orb } from "../ui/Orb";
import "./HomeHero.css";

export function HomeHero() {
  const ref = useFx<HTMLElement>();
  return (
    <section ref={ref} className="home-hero" data-fx="aurora">
      <Orb size={56} />
      <h1 className="home-hero__title">Relis ton code, sans te presser.</h1>
      <p className="home-hero__lead">
        Une review qui vérifie ce qu'elle avance, un nettoyage qui ne touche pas à ton travail, et
        rien de publié sans ton accord.
      </p>
    </section>
  );
}
