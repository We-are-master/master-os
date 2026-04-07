-- App: weekly_friday | biweekly_friday (due dates on Fridays; first snaps to Friday on/after chosen date).
COMMENT ON COLUMN bills.recurrence_interval IS
  'weekly | weekly_friday | biweekly_friday | monthly | quarterly | yearly — pre-generated occurrences, not chained only on mark paid';
