import copy
import unittest
from spawns import editable_spawns, validate_spawns


class SpawnTests(unittest.TestCase):
    def setUp(self):
        self.defaults = [dict(team=0, entry=0, x_m=15.00000001, y_m=50, z_m=4),
                         dict(team=1, entry=32, x_m=85, y_m=50, z_m=5)]
        self.bounds = dict(x_min_m=0, x_max_m=100, y_min_m=0, y_max_m=100)
        self.doc = dict(version=3, default_spawn_points=copy.deepcopy(self.defaults),
                        spawn_points=editable_spawns(self.defaults))

    def test_roundtrip_and_legacy_defaults(self):
        self.assertEqual(validate_spawns(self.doc, self.defaults, self.bounds), editable_spawns(self.defaults))
        self.assertEqual(validate_spawns(dict(version=2), self.defaults, self.bounds), editable_spawns(self.defaults))
        self.doc['spawn_points'][0]['x_m'] = 22.123
        self.assertEqual(validate_spawns(self.doc, self.defaults, self.bounds)[0]['x_m'], 22.123)
        self.assertEqual(self.defaults[0]['x_m'], 15.00000001)

    def test_invalid_spawns_and_tampered_defaults_rejected(self):
        for update in [dict(x_m=-1), dict(x_m=101), dict(y_m=True), dict(x_m=float('nan')),
                       dict(x_m=12.3456), dict(team=1), dict(entry=32), dict(z_m=99)]:
            doc = copy.deepcopy(self.doc); doc['spawn_points'][0].update(update)
            with self.subTest(update=update), self.assertRaises(ValueError):
                validate_spawns(doc, self.defaults, self.bounds)
        doc = copy.deepcopy(self.doc); doc['default_spawn_points'][0]['x_m'] = 20
        with self.assertRaises(ValueError): validate_spawns(doc, self.defaults, self.bounds)
        doc = copy.deepcopy(self.doc); doc['spawn_points'][0].update(x_m=85, y_m=50)
        with self.assertRaises(ValueError): validate_spawns(doc, self.defaults, self.bounds)
        with self.assertRaises(ValueError): validate_spawns(dict(self.doc, version=2), self.defaults, self.bounds)
