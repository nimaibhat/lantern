import { getHomeModel } from "@/lib/world/store";
import { ZoneEditor } from "./zone-editor";

export default async function EditWorldPage() {
  const { model, saved } = await getHomeModel();
  return (
    <div className="audit">
      <div className="page-head">
        <div>
          <h1>Edit the home model</h1>
          <p className="muted">Draw zones, place doors, and drag each listener to where its laptop really sits. Saving creates a new version.</p>
        </div>
      </div>
      <ZoneEditor initial={model} saved={saved} />
    </div>
  );
}
