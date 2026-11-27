Gauge archive, engineer's synthetic planning estimates for weather.pulses:
10,000 rows at 1 KB per row, growth 2% per month. Read one station and day's pulses at 12 requests/second
with a 50 ms budget; append single readings at 3 writes/second with a 100 ms budget.
There is no application, production trace or service endpoint in this handoff.
