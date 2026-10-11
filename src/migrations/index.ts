


// @ts-ignore - Loaded as text modules via wrangler rules
// @ts-ignore
import migration0000 from './sql/0001_conscious_karen_page.sql';
// @ts-ignore
import migration0001 from './sql/0002_light_spectrum.sql';
// @ts-ignore
import migration0002 from './sql/0003_steady_ted_forrester.sql';
// @ts-ignore
import migration0003 from './sql/0004_gorgeous_kang.sql';
// @ts-ignore
import migration0004 from './sql/0005_free_siren.sql';
// @ts-ignore
import migration0005 from './sql/0006_lone_atom.sql';
// @ts-ignore
import migration0006 from './sql/0007_application_sort_key.sql';
// @ts-ignore
import migration0007 from './sql/0008_client_elevated_until.sql';
// @ts-ignore
import migration0008 from './sql/0009_unusual_human_cannonball.sql';
// @ts-ignore
import migration0009 from './sql/0010_same_firestar.sql';
// @ts-ignore
import migration0010 from './sql/0011_active_device_token_unique.sql';
// @ts-ignore
import migration0011 from './sql/0012_wonderful_random.sql';

export const migrations: Record<string, string> = {
  '0001_conscious_karen_page': migration0000,
  '0002_light_spectrum': migration0001,
  '0003_steady_ted_forrester': migration0002,
  '0004_gorgeous_kang': migration0003,
  '0005_free_siren': migration0004,
  '0006_lone_atom': migration0005,
  '0007_application_sort_key': migration0006,
  '0008_client_elevated_until': migration0007,
  '0009_unusual_human_cannonball': migration0008,
  '0010_same_firestar': migration0009,
  '0011_active_device_token_unique': migration0010,
  '0012_wonderful_random': migration0011,
};

export default migrations;
