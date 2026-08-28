# Eval dimension + volume report

## Per-dimension means by cell

### Seed 1 (`1-2026-08-26T09-18-59-339Z`)

| cell | n | recognized | asked_right | not_interrogated | no_silent_guess | accuracy | voice | would_proceed |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| capsule×complete | 4 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| capsule×partial | 10 | 3.4 | 3.5 | 3.7 | 3.5 | 3.6 | 3.5 | 3.9 |
| capsule×vague | 5 | 2.8 | 3.2 | 3.2 | 3.2 | 3 | 3 | 3.2 |
| multi_item×complete | 2 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| multi_item×partial | 4 | 3.25 | 3.5 | 3.25 | 3.25 | 3 | 3.25 | 3.25 |
| multi_item×vague | 9 | 2.78 | 2.89 | 2.89 | 3 | 2.78 | 2.89 | 3 |
| outfit×complete | 6 | 3.17 | 3.33 | 3.33 | 3.17 | 3.33 | 3 | 3.33 |
| outfit×partial | 4 | 3.25 | 3.5 | 3.25 | 3.25 | 3.5 | 3 | 3.25 |
| outfit×vague | 6 | 3.67 | 4 | 3.83 | 3.5 | 3.17 | 3.67 | 3.83 |
| single_item×complete | 6 | 3 | 3.17 | 3.33 | 2.83 | 3.17 | 2.67 | 3 |
| single_item×partial | 7 | 3.29 | 3.57 | 3.29 | 3.43 | 3.43 | 3.14 | 3.43 |
| single_item×vague | 5 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |

### Seed 2 (`2-2026-08-27T08-11-34-446Z`)

| cell | n | recognized | asked_right | not_interrogated | no_silent_guess | accuracy | voice | would_proceed |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| capsule×complete | 8 | 3 | 3.25 | 3.38 | 3.13 | 3.25 | 2.75 | 3.25 |
| capsule×partial | 3 | 3.33 | 3.67 | 2.67 | 4 | 3.33 | 3.33 | 3.33 |
| capsule×vague | 5 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| multi_item×complete | 5 | 3.2 | 3.4 | 3.4 | 3.2 | 3.4 | 3 | 3.4 |
| multi_item×partial | 6 | 3.33 | 3.33 | 3.33 | 3.17 | 3.33 | 3.17 | 3.33 |
| multi_item×vague | 4 | 3.5 | 3.5 | 3.5 | 3.25 | 3.25 | 3.5 | 3.5 |
| outfit×complete | 7 | 2.86 | 3.29 | 3.86 | 2.57 | 3.29 | 2.29 | 3.14 |
| outfit×partial | 7 | 3.14 | 3.14 | 3.29 | 3.29 | 3.29 | 3.14 | 3.29 |
| outfit×vague | 5 | 3.8 | 3.8 | 3.8 | 3.6 | 3.6 | 3.4 | 3.8 |
| single_item×complete | 4 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| single_item×partial | 9 | 3.11 | 3.22 | 3.22 | 3.11 | 3.22 | 3.11 | 3.22 |
| single_item×vague | 5 | 3.2 | 3.2 | 3.2 | 3.2 | 3.4 | 3 | 3.2 |

## Consult / questions volume — before vs after gates

Before = `1-2026-08-25T12-33-48-238Z` (iter2b, pre anchor/slots/consistency gates).
After = judged seed1 + seed2 runs above.

### Before gates
- question_rounds (ask turns): mean **1.7** n=20 hist={"0":2,"1":8,"2":6,"3":2,"4":2}
- questions-per-appointment (sum of clarification Qs): mean **4.05** n=20 hist={"0":2,"1":3,"2":2,"3":5,"4":1,"5":3,"6":1,"10":1,"11":1,"13":1}
- consult_rounds_used (brief): mean **0.94** n=17 hist={"0":2,"1":14,"2":1}

### After gates — seed 1
- question_rounds (ask turns): mean **1.75** n=68 hist={"0":3,"1":23,"2":33,"3":7,"4":1,"5":1}
- questions-per-appointment (sum of clarification Qs): mean **3.1** n=68 hist={"0":3,"1":10,"2":15,"3":13,"4":15,"5":7,"6":3,"9":1,"10":1}
- consult_rounds_used (brief): mean **0.94** n=54 hist={"0":3,"1":51}

### After gates — seed 2
- question_rounds (ask turns): mean **1.62** n=68 hist={"0":11,"1":20,"2":24,"3":10,"4":3}
- questions-per-appointment (sum of clarification Qs): mean **2.82** n=68 hist={"0":11,"1":12,"2":5,"3":9,"4":19,"5":8,"6":3,"9":1}
- consult_rounds_used (brief): mean **0.88** n=60 hist={"0":7,"1":53}

