Runs of tools/grade-target-ab.js against qwen/qwen3-30b-a3b-instruct-2507 at HSK 3,
3 repeats over 20 hand-written fixtures (five tags x good/bad/other/dodge).
Each block is one wording of the target question. See RESEARCH.md, "Judging
the drilled structure on its own".

### 1. an extra field on grade(), first wording

target verdict, drill arm (59 graded):
kind    n    used right  ok right
good    14   12/14       14/14
bad     15   15/15       12/15
other   15   15/15       6/15
dodge   15   10/15       15/15

both fields right: 40/59

tag accuracy, the control (does the drill block spoil the ledger?):
  drill   35/59
  plain   41/59

disagreements:
  [other measure-word] 我昨天买了两本书了  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [good aspect-le] 我昨天看了一个电影  got {"used":false,"ok":true} want {"used":true,"ok":true}
  [dodge aspect-le] 我每天都喝茶  got {"used":true,"ok":false} want {"used":false,"ok":null}
  [other negation-bu-mei] 我昨天没去学校了  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [other comparison-bi] 今天比昨天冷了一点儿，我没有穿多衣服  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [dodge comparison-bi] 今天天气很好  got {"used":true,"ok":false} want {"used":false,"ok":null}
  [bad de-particles] 他跑的很快  got {"used":true,"ok":true} want {"used":true,"ok":false}
  [other measure-word] 我昨天买了两本书了  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [dodge aspect-le] 我每天都喝茶  got {"used":true,"ok":false} want {"used":false,"ok":null}
  [other negation-bu-mei] 我昨天没去学校了  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [other comparison-bi] 今天比昨天冷了一点儿，我没有穿多衣服  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [dodge comparison-bi] 今天天气很好  got {"used":true,"ok":false} want {"used":false,"ok":null}

cost $0.0138

### 2. an extra field on grade(), sharpened wording

target verdict, drill arm (59 graded):
kind    n    used right  ok right
good    14   14/14       11/14
bad     15   15/15       9/15
other   15   15/15       6/15
dodge   15   12/15       15/15

both fields right: 38/59

tag accuracy, the control (does the drill block spoil the ledger?):
  drill   34/59
  plain   42/59

disagreements:
  [good aspect-le] 我昨天看了一个电影  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [bad aspect-le] 我很高兴了  got {"used":true,"ok":true} want {"used":true,"ok":false}
  [other aspect-le] 我昨天看了三个电影  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [dodge aspect-le] 我每天都喝茶  got {"used":true,"ok":false} want {"used":false,"ok":null}
  [other negation-bu-mei] 我昨天没去学校了  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [other comparison-bi] 今天比昨天冷了一点儿，我没有穿多衣服  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [bad de-particles] 他跑的很快  got {"used":true,"ok":true} want {"used":true,"ok":false}
  [good aspect-le] 我昨天看了一个电影  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [bad aspect-le] 我很高兴了  got {"used":true,"ok":true} want {"used":true,"ok":false}
  [other aspect-le] 我昨天看了三个电影  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [dodge aspect-le] 我每天都喝茶  got {"used":true,"ok":false} want {"used":false,"ok":null}
  [other negation-bu-mei] 我昨天没去学校了  got {"used":true,"ok":false} want {"used":true,"ok":true}

cost $0.0142

### 3. its own call, first wording

target verdict, drill arm (60 graded):
kind    n    used right  ok right
good    15   12/15       15/15
bad     15   9/15        4/15
other   15   12/15       15/15
dodge   15   15/15       15/15

both fields right: 41/60

tag accuracy, grader untouched by the drill: 42/60

disagreements:
  [bad measure-word] 我买了两个书  got {"used":false,"ok":true} want {"used":true,"ok":false}
  [bad aspect-le] 我很高兴了  got {"used":true,"ok":true} want {"used":true,"ok":false}
  [good negation-bu-mei] 我昨天没去学校  got {"used":false,"ok":true} want {"used":true,"ok":true}
  [bad negation-bu-mei] 我昨天不去学校  got {"used":false,"ok":true} want {"used":true,"ok":false}
  [other negation-bu-mei] 我昨天没去学校了  got {"used":false,"ok":true} want {"used":true,"ok":true}
  [bad comparison-bi] 今天比昨天很冷  got {"used":true,"ok":true} want {"used":true,"ok":false}
  [bad measure-word] 我买了两个书  got {"used":false,"ok":false} want {"used":true,"ok":false}
  [bad aspect-le] 我很高兴了  got {"used":true,"ok":true} want {"used":true,"ok":false}
  [good negation-bu-mei] 我昨天没去学校  got {"used":false,"ok":true} want {"used":true,"ok":true}
  [bad negation-bu-mei] 我昨天不去学校  got {"used":false,"ok":true} want {"used":true,"ok":false}
  [other negation-bu-mei] 我昨天没去学校了  got {"used":false,"ok":true} want {"used":true,"ok":true}
  [bad comparison-bi] 今天比昨天很冷  got {"used":true,"ok":true} want {"used":true,"ok":false}

cost $0.0077

### 4. its own call, used = attempted, plus the tag's worked pair

target verdict, drill arm (56 graded):
kind    n    used right  ok right
good    13   13/13       13/13
bad     15   15/15       13/15
other   14   14/14       10/14
dodge   14   10/14       14/14

both fields right: 46/56

tag accuracy, grader untouched by the drill: 37/54

disagreements:
  [dodge measure-word] 我很喜欢看书  got {"used":true,"ok":true} want {"used":false,"ok":null}
  [other aspect-le] 我昨天看了三个电影  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [other negation-bu-mei] 我昨天没去学校了  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [dodge measure-word] 我很喜欢看书  got {"used":true,"ok":true} want {"used":false,"ok":null}
  [other negation-bu-mei] 我昨天没去学校了  got {"used":true,"ok":false} want {"used":true,"ok":true}
  [bad comparison-bi] 今天比昨天很冷  got {"used":true,"ok":true} want {"used":true,"ok":false}
  [dodge de-particles] 我今天很累  got {"used":true,"ok":true} want {"used":false,"ok":null}
  [dodge measure-word] 我很喜欢看书  got {"used":true,"ok":true} want {"used":false,"ok":null}
  [bad aspect-le] 我很高兴了  got {"used":true,"ok":true} want {"used":true,"ok":false}
  [other aspect-le] 我昨天看了三个电影  got {"used":true,"ok":false} want {"used":true,"ok":true}

cost $0.0062

### 5. shipped: 4, plus "nothing of the kind" for the dodge case

target verdict, drill arm (60 graded):
kind    n    used right  ok right
good    15   15/15       15/15
bad     15   15/15       12/15
other   15   15/15       15/15
dodge   15   12/15       15/15

both fields right: 54/60

tag accuracy, grader untouched by the drill: 42/60

disagreements:
  [dodge measure-word] 我很喜欢看书  got {"used":true,"ok":true} want {"used":false,"ok":null}
  [bad comparison-bi] 今天比昨天很冷  got {"used":true,"ok":true} want {"used":true,"ok":false}
  [dodge measure-word] 我很喜欢看书  got {"used":true,"ok":true} want {"used":false,"ok":null}
  [bad aspect-le] 我很高兴了  got {"used":true,"ok":true} want {"used":true,"ok":false}
  [dodge measure-word] 我很喜欢看书  got {"used":true,"ok":true} want {"used":false,"ok":null}
  [bad comparison-bi] 今天比昨天很冷  got {"used":true,"ok":true} want {"used":true,"ok":false}

cost $0.0079
