import type { DocumentBlock } from "./documentBlocks";

export interface AcademicTerm {
  term: string;
  translation: string;
  definition: string;
  blockId: string;
  pageNumber: number;
  count: number;
  example: string;
  source: "local" | "ai";
}

type GlossaryEntry = readonly [term: string, translation: string, definition: string, aliases?: readonly string[]];

// Inflections and spelling variants are listed explicitly; never infer a stem.
const GLOSSARY: readonly GlossaryEntry[] = [
  ["hypothesis", "假设", "对现象或变量关系提出、可用数据检验的解释。", ["hypotheses"]],
  ["theory", "理论", "用一组相互关联的概念和命题解释现象的体系。", ["theories"]],
  ["framework", "框架", "组织研究问题、概念关系或系统组成的总体结构。", ["frameworks"]],
  ["methodology", "方法论", "说明研究采用哪些方法以及选择这些方法的依据。", ["methodologies"]],
  ["assumption", "前提假设", "推导或建模时预先接受、通常需要检查适用性的条件。", ["assumptions"]],
  ["criterion", "准则", "用于判断方案、结果或样本是否满足要求的标准。", ["criteria"]],
  ["constraint", "约束", "限制可行解、变量取值或系统行为的条件。", ["constraints"]],
  ["objective", "目标", "研究希望达成的结果，或优化问题需要改善的量。", ["objectives"]],
  ["analysis", "分析", "分解并考察数据或问题的结构，以解释规律和关系。", ["analyses"]],
  ["inference", "推断", "根据观察数据和已知条件推导未知性质或结论。", ["inferences"]],
  ["estimation", "估计", "利用样本信息近似确定未知参数或目标量。", ["estimations"]],
  ["optimization", "优化", "在给定约束下寻找使目标函数更优的参数或方案。", ["optimisation"]],
  ["approximation", "近似", "用较容易计算或理解的表达替代精确对象，并容许误差。", ["approximations"]],
  ["distribution", "分布", "描述变量各个取值或取值区间出现的概率规律。", ["distributions"]],
  ["variance", "方差", "衡量数据偏离均值的程度，等于平方偏差的期望。", ["variances"]],
  ["correlation", "相关性", "两个变量共同变化的关系；相关本身不能证明因果。", ["correlations"]],
  ["causality", "因果关系", "一个因素的改变会导致另一个因素发生变化的关系。"],
  ["probability", "概率", "在给定模型或条件下，事件发生的可能性数值。", ["probabilities"]],
  ["likelihood", "似然", "固定观测数据后，比较不同参数对这些数据的支持程度。", ["likelihoods"]],
  ["bias", "偏差", "估计值或预测结果相对目标值产生的系统性偏离。", ["biases"]],
  ["parameter", "参数", "决定模型形式或行为的数值，可由设定或数据估计得到。", ["parameters"]],
  ["variable", "变量", "在研究中可以变化、测量或控制的属性或数值。", ["variables"]],
  ["sample", "样本", "从总体中取得、用于分析或推断的一组观测。", ["samples"]],
  ["dataset", "数据集", "按照任务和格式组织、供分析或模型训练使用的数据集合。", ["datasets", "data set", "data sets"]],
  ["benchmark", "基准测试", "用统一数据和规则比较不同方法表现的测试。", ["benchmarks"]],
  ["baseline", "基线", "作为比较起点的方法或结果，用于衡量新方法的改进。", ["baselines"]],
  ["evaluation", "评估", "根据明确指标检查方法、模型或系统的实际表现。", ["evaluations"]],
  ["validation", "验证", "检查方法或结论是否符合预期，并评估其适用性。", ["validations"]],
  ["experiment", "实验", "通过受控操作或预定程序收集证据、检验研究问题。", ["experiments"]],
  ["empirical", "实证的", "依据实际观察或实验数据，而非仅依赖理论推导。"],
  ["robustness", "稳健性", "当输入、噪声或假设发生变化时，方法仍保持表现的能力。"],
  ["generalization", "泛化", "模型将从已有数据学到的规律应用于未见数据的能力。", ["generalisation"]],
  ["reproducibility", "可复现性", "按公开的数据、代码和步骤重新得到研究结果的能力。"],
  ["reliability", "可靠性", "测量或方法在重复使用时保持一致结果的程度。"],
  ["validity", "有效性", "测量是否反映目标概念，或结论是否获得充分证据支持。"],
  ["significance", "显著性", "研究结果的重要程度；统计语境下须结合检验标准理解。"],
  ["confidence interval", "置信区间", "由样本构造的参数区间；重复抽样时按设定比例覆盖真值。", ["confidence intervals"]],
  ["statistical significance", "统计显著性", "检验结果达到预设阈值，不等于效应很大或具有实际价值。"],
  ["effect size", "效应量", "量化差异或关联的大小，补充显著性检验的信息。", ["effect sizes"]],
  ["standard deviation", "标准差", "方差的平方根，以原始数据的单位表示离散程度。", ["standard deviations"]],
  ["regression", "回归", "建立变量之间的关系，常用于解释或预测连续数值。", ["regressions"]],
  ["classification", "分类", "根据输入特征将对象分配到预先定义的类别。", ["classifications"]],
  ["clustering", "聚类", "按照相似性将对象分组，通常不依赖预先给定的标签。"],
  ["overfitting", "过拟合", "模型过度适应训练数据中的细节或噪声，导致泛化变差。", ["over-fitting"]],
  ["underfitting", "欠拟合", "模型未能充分学习数据中的规律，训练和预测表现均受限。", ["under-fitting"]],
  ["regularization", "正则化", "用惩罚项或其他限制控制模型复杂度，减少过拟合。", ["regularisation"]],
  ["gradient", "梯度", "函数对各变量的偏导数组成的向量，指示局部增长方向。", ["gradients"]],
  ["convergence", "收敛", "迭代结果逐渐接近某个稳定值或满足规定停止条件。"],
  ["accuracy", "准确率", "分类任务中，预测正确的样本占全部样本的比例。"],
  ["precision", "精确率", "预测为正类的样本中，实际正类所占的比例。"],
  ["recall", "召回率", "实际正类样本中，被模型成功识别为正类的比例。"],
  ["efficiency", "效率", "完成任务所需的时间、计算或存储资源与产出的关系。"],
  ["complexity", "复杂度", "问题或算法随输入规模增长所需资源的变化程度。", ["complexities"]],
  ["ablation study", "消融实验", "移除或替换系统的某个组成部分，以衡量它对结果的贡献。", ["ablation studies"]],
  ["cross-validation", "交叉验证", "轮流用不同数据子集训练和验证，以评估模型的泛化表现。"],
  ["state-of-the-art", "当前先进水平", "在特定任务、指标和比较范围内，已有方法达到的先进表现。"],
  ["trade-off", "权衡", "改善一个目标时可能牺牲另一个目标，需要比较得失。", ["trade-offs", "tradeoff", "tradeoffs"]],
  ["qualitative", "定性的", "通过描述、分类或解释研究对象的性质，而非只给数值。"],
  ["quantitative", "定量的", "通过数值测量和统计分析研究对象的大小、差异或关系。"],
  ["model", "模型", "对现象或系统的简化表示，用于描述、推断或预测。", ["models"]],
  ["architecture", "架构", "系统或模型各组成部分的组织方式及其连接关系。", ["architectures"]],
  ["algorithm", "算法", "为解决某类问题而规定的一组可执行计算步骤。", ["algorithms"]],
  ["representation", "表示", "把对象或信息编码为便于计算和比较的形式。", ["representations"]],
  ["embedding", "嵌入", "把离散对象映射到向量空间，使其关系可由向量表示。", ["embeddings"]],
  ["attention", "注意力", "按照相关性为输入信息分配不同权重的计算机制。"],
  ["neural network", "神经网络", "由相互连接的计算单元组成、通过参数学习映射关系的模型。", ["neural networks"]],
  ["training", "训练", "使用训练数据和学习规则调整模型参数的过程。"],
  ["learning rate", "学习率", "控制优化过程中每次参数更新步长的数值。", ["learning rates"]],
  ["loss function", "损失函数", "把预测结果与目标之间的差异转化为可优化的数值。", ["loss functions"]],
  ["feature", "特征", "用于描述样本、供模型判断或预测的可观测属性。", ["features"]],
  ["sequence", "序列", "按顺序排列的元素集合，元素的位置与前后关系具有意义。", ["sequences"]],
  ["transduction", "转换", "把输入序列直接变换为另一序列，如翻译中的源语言到目标语言。"],
  ["recurrent", "循环的", "重复使用同一计算结构，并将前一步状态传到后一步。"],
  ["convolution", "卷积", "用滑动的局部核对输入加权组合，以提取局部模式。", ["convolutions"]],
  ["parallelization", "并行化", "把计算拆成可以同时执行的部分，以缩短总运行时间。", ["parallelisation"]],
  ["scalability", "可扩展性", "数据量或负载增长时，通过增加资源维持系统表现的能力。"],
  ["novel", "新颖的", "相对已有研究引入新的思路、方法或发现，须说明具体差异。"],
  ["comprehensive", "全面的", "覆盖问题的多个主要方面或评价维度，而非只考察局部。"],
  ["substantial", "显著的／可观的", "变化或贡献的幅度较大；不直接表示通过统计显著性检验。"],
  ["consistent", "一致的", "多次观察或不同条件下的结果相互符合，没有明显矛盾。"],
  ["explicit", "显式的", "信息或规则被直接写明，而不需要从上下文推断。"],
  ["implicit", "隐式的", "信息或规则包含在结构或行为中，未被直接写明。"],
  ["limitation", "局限", "限制方法适用范围、结论强度或研究完整性的因素。", ["limitations"]],
  ["interpretation", "解释", "结合研究背景说明数据、结果或模型行为意味着什么。", ["interpretations"]],
  ["implementation", "实现", "将方法或算法转化为可运行程序或可执行系统的过程。", ["implementations"]],
  ["replication", "重复研究", "重新开展研究以检查原结论是否在新的执行中仍然成立。", ["replications"]],
  ["self-attention", "自注意力", "同一序列内部的位置相互计算相关性，从而汇集上下文信息。"],
  ["multi-head attention", "多头注意力", "在多个表示子空间分别计算注意力，再合并各头的结果。", ["multihead attention"]],
  ["feed-forward", "前馈的", "信号沿输入到输出的方向传播，计算连接中没有循环反馈。", ["feedforward"]],
  ["encoder", "编码器", "将输入转换为内部表示，供后续预测或生成步骤使用。", ["encoders"]],
  ["decoder", "解码器", "依据内部表示和已有输出，生成或恢复目标信息。", ["decoders"]],
  ["residual connection", "残差连接", "把层的输入与其变换结果相加，使信息和梯度更易传播。", ["residual connections"]],
  ["positional encoding", "位置编码", "为序列元素加入位置信息，使模型能够区分顺序。", ["positional encodings"]],
  ["attention mechanism", "注意力机制", "根据查询与候选信息的相关性生成权重并聚合信息。", ["attention mechanisms"]],
];

const SEPARATORS = /[\s\-\u00ad\u2010-\u2015]+/u;
const NOISE = new Set(
  ("a an the and or but of to in on at by for from with without as is are was were be been being " +
    "it its this that these those we our us you your they their them he she his her " +
    "can could may might must should would will have has had do does did not no yes " +
    "all any some other each both more most less very also such than then there here " +
    "new good large small different use used using based paper papers study studies work works " +
    "result results section sections figure figures table tables however therefore").split(" "),
);

interface Candidate {
  term: string;
  translation: string;
  definition: string;
  aliases: Set<string>;
  source: AcademicTerm["source"];
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase().split(SEPARATORS).join(" ");
}

function literalPattern(value: string): string {
  return value.split(SEPARATORS)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s\\-\\u00ad\\u2010-\\u2015]+");
}

function matcher(aliases: Set<string>): RegExp {
  const alternatives = [...aliases].sort((left, right) => right.length - left.length).map(literalPattern);
  // Unicode letters, marks, digits and underscores keep modelled, démodel,
  // model2 and _model from being mistaken for the standalone word "model".
  return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}\\p{M}_])`, "giu");
}

function isUsefulEnglishTerm(term: string): boolean {
  const key = normalizedKey(term);
  if (!/[a-z]/i.test(term) || /\p{Script=Han}/u.test(term) || /^[a-z]$/i.test(key)) return false;
  if (["et al", "et al.", "e.g.", "i.e."].includes(key)) return false;
  return !key.split(" ").every((word) => NOISE.has(word));
}

function sourceExample(text: string, index: number, length: number): string {
  let start = 0;
  let end = text.length;
  for (const punctuation of text.matchAll(/[.!?](?=\s|$)/g)) {
    const boundary = punctuation.index! + 1;
    if (boundary <= index) start = boundary;
    else if (boundary >= index + length) { end = boundary; break; }
  }
  if (end - start > 240) {
    start = Math.max(start, index - 80);
    end = Math.min(end, Math.max(index + length, start + 240));
  }
  return text.slice(start, end).trim();
}

/**
 * Pure, source-grounded glossary extraction. Only explicit spelling/inflection
 * aliases are merged. AI suggestions enrich definitions, never supply evidence.
 */
export function extractAcademicVocabulary(
  blocks: DocumentBlock[],
  aiTerms: Array<{ term: string; translation: string; definition?: string }> = [],
): AcademicTerm[] {
  const candidates: Candidate[] = [];
  const lookup = new Map<string, Candidate>();
  for (const [term, translation, definition, variants = []] of GLOSSARY) {
    const candidate: Candidate = { term, translation, definition, aliases: new Set([term, ...variants]), source: "local" };
    candidates.push(candidate);
    for (const alias of candidate.aliases) lookup.set(normalizedKey(alias), candidate);
  }

  for (const suggestion of aiTerms) {
    if (typeof suggestion.term !== "string" || typeof suggestion.translation !== "string") continue;
    const term = suggestion.term.trim().replace(/\s+/g, " ");
    const translation = suggestion.translation.trim();
    if (!term || !translation || !isUsefulEnglishTerm(term)) continue;
    const key = normalizedKey(term);
    const existing = lookup.get(key);
    // Preserve the first valid AI description, irrespective of repeated casing.
    if (existing?.source === "ai") continue;
    const definition = suggestion.definition?.trim();
    if (existing) {
      existing.source = "ai";
      existing.translation = translation;
      if (definition) existing.definition = definition;
      existing.aliases.add(term);
    } else {
      const candidate: Candidate = {
        term, translation, definition: definition || translation, aliases: new Set([term]), source: "ai",
      };
      candidates.push(candidate);
      lookup.set(key, candidate);
    }
  }

  const sourceBlocks = blocks.filter((block) => block.kind === "heading" || block.kind === "paragraph")
    .sort((left, right) => left.order - right.order || left.pageNumber - right.pageNumber);
  const extracted: AcademicTerm[] = [];
  for (const candidate of candidates) {
    const expression = matcher(candidate.aliases);
    let evidence: AcademicTerm | undefined;
    for (const block of sourceBlocks) {
      expression.lastIndex = 0;
      for (const match of block.text.matchAll(expression)) {
        if (!evidence) {
          evidence = {
            term: candidate.term,
            translation: candidate.translation,
            definition: candidate.definition,
            blockId: block.id,
            pageNumber: block.pageNumber,
            count: 0,
            example: sourceExample(block.text, match.index!, match[0].length),
            source: candidate.source,
          };
        }
        evidence.count += 1;
      }
    }
    if (evidence) extracted.push(evidence);
  }

  return extracted.sort((left, right) =>
    Number(right.source === "ai") - Number(left.source === "ai") ||
    right.count - left.count || left.term.localeCompare(right.term, "en"),
  ).slice(0, 80);
}
