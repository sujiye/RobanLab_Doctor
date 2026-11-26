'use strict';
/**
 * symptom-intake —— 把用户的自然语言故障描述结构化。
 *
 * 只做分类和补问，不诊断、不连接机器人。
 * 视觉观察由具备视觉能力的 agent 在调用本 workflow 前整理成 observations JSON。
 */

const id = 'symptom-intake';
const title = '故障描述结构化';
const description = '提取部位/症状标签、红旗风险，并生成需要补充的问题';
const inputs = {
  description: 'string，用户原话',
  part: 'string|null，用户指出的部位/关节',
  since: 'string|null，什么时候开始/是否偶发',
  recentChanges: 'string|null，最近拆装/升级/摔碰/换电池等',
  errorText: 'string|null，屏幕/终端报错原文',
  hasImages: 'boolean，是否已有照片/截图'
};

const TAGS = [
  { id: 'arm', re: /手臂|胳膊|关节|手腕|肘|肩|左臂|右臂|机械臂/i },
  { id: 'head', re: /头|脖子|颈部|云台/i },
  { id: 'camera', re: /相机|摄像头|画面|黑屏|图像|视觉|镜头/i },
  { id: 'motion', re: /不动|没反应|卡住|抖动|抖|异响|下垂|掉下来|抬不起|动不了|卡顿/i },
  { id: 'zero', re: /零位|零点|回零|角度不对|角度不准|偏移|零点漂移/i },
  { id: 'battery', re: /电池|掉电|续航|电压|充不上|断电/i },
  { id: 'network', re: /连不上|断网|网络|ssh|wifi|无线|超时/i },
  { id: 'software', re: /报错|程序|节点|日志|启动|崩溃|异常|服务/i },
  { id: 'gait', re: /走路|步态|站不稳|摔倒|平衡|行走/i },
  { id: 'audio', re: /声音|麦克风|喇叭|语音|听不到/i }
];

const RED_FLAGS = /冒烟|烧焦|异味|焦味|发烫|过热|火花|摔倒|跌落|漏电|异常响声/i;

function classify(text) {
  const source = String(text || '');
  const tags = TAGS.filter((tag) => tag.re.test(source)).map((tag) => tag.id);
  const redFlags = RED_FLAGS.test(source);
  return { tags, redFlags };
}

function questionsFor({ description, tags, hasImages, redFlags }) {
  const questions = [];
  if (!description || description.trim().length < 4) {
    questions.push('请用一两句话描述你看到/听到的异常，以及它是什么时候开始的。');
  }
  if (!tags.length) {
    questions.push('异常发生在哪个部位：手臂/头部/相机/行走/电池/网络/语音？');
  }
  if (!hasImages) {
    questions.push('能否拍一张照片或短视频帧？画面里尽量包含异常部位和机器人整体姿态。');
  }
  if (tags.includes('zero')) {
    questions.push('是哪个关节/哪条手臂？最近是否拆装过舵机臂或更换过舵机？');
  }
  if (tags.includes('camera')) {
    questions.push('是头部 RealSense 还是下巴相机？画面是完全黑屏、花屏，还是打不开设备？');
  }
  if (tags.includes('motion')) {
    questions.push('关节是完全没有反应、被卡住、下垂，还是能动但角度不对？');
  }
  if (redFlags) {
    questions.push('如果出现冒烟、焦味、发烫或跌落，请先断电并人工检查，不要继续运行。');
  }
  return questions;
}

async function run(ctx, input = {}) {
  const description = String(input.description || '').trim();
  const { tags, redFlags } = classify(description + ' ' + String(input.part || '') + ' ' + String(input.errorText || ''));
  const hasImages = input.hasImages === true;
  const questions = questionsFor({ description, tags, hasImages, redFlags });

  let severity = 'low';
  if (redFlags) severity = 'critical';
  else if (tags.includes('motion') || tags.includes('zero') || tags.includes('camera')) severity = 'medium';
  else if (tags.includes('software') || tags.includes('network')) severity = 'medium';

  const symptom = {
    description,
    part: input.part || null,
    since: input.since || null,
    recentChanges: input.recentChanges || null,
    errorText: input.errorText || null,
    tags,
    redFlags,
    severity,
    hasImages,
    questions,
    needsClarification: questions.length > 0
  };

  ctx.log(
    `[symptom] tags=${tags.join(',') || '-'} severity=${severity} ` +
    `images=${hasImages} questions=${questions.length}`
  );
  return { state: { symptom }, symptom };
}

module.exports = { id, title, description, inputs, run, classify, questionsFor, TAGS, RED_FLAGS };
