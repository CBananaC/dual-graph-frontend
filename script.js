document.addEventListener("DOMContentLoaded", function () { 
  const API_BASE_URL = "https://dual-graph-api.onrender.com";

  let peopleData = {};              // { id: person }
  let fullAccusationData = {};      // 指控關係原始數據（edges）
  let fullTestimonyData = {};       // 證供關係原始數據（edges）
  let accusationGraph, testimonyGraph;
  let selectedPersonId = null;      // 從指控關係圖選中的 node
  let selectedGraphType = null;     // "accusation" 或 "testimony"
  let activeButton = null;          // "accuser"、"accused"、"showAll"
  // 記錄目前證供關係顯示模式，可能值 "accuser" 或 "accused"
  let testimonyRelationMode = null;
  let testimonyDisplayMode = "normal"; 

  // ---------------------------
  // 通用輔助函式
  // ---------------------------
  
  function getColorByIdentity(identity) {
    const mapping = {
      "功臣": "#73a0fa",
      "藍玉": "#73d8fa",
      "功臣僕役": "#cfcfcf",
      "功臣親屬": "#cfcfcf",
      "文官": "#cfcfcf",
      "武官": "#fa73c4",
      "皇帝": "#faf573",
      "胡惟庸功臣": "#73fa9e",
      "都督": "#8e73fa",
      "都督僕役": "#cfcfcf",
      "都督親屬": "#cfcfcf"
    };
    return mapping[identity] || "#999999";
  }

  function preprocessEdges(edges) {
    const groups = {};
    edges.forEach(edge => {
      const key = `${edge.from}_${edge.to}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(edge);
    });
    const result = [];
    for (const key in groups) {
      const group = groups[key];
      if (group.length === 1) {
        result.push(group[0]);
      } else {
        group.forEach((edge, index) => {
          edge.smooth = {
            enabled: true,
            type: index % 2 === 1 ? "curvedCW" : "curvedCCW",
            roundness: 0.1 + index * 0.1
          };
          result.push(edge);
        });
      }
    }
    return result;
  }

  async function fetchPeopleData() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/people`);
      const data = await response.json();
      return data.reduce((acc, person) => {
        person.id = person.id.toString();
        acc[person.id] = person;
        return acc;
      }, {});
    } catch (error) {
      console.error("❌ 無法獲取人物數據:", error);
      return {};
    }
  }

  function convertRelationshipData(data, nameToId) {
    data.edges = data.edges.map(edge => {
      if (edge.From && !edge.from) { edge.from = edge.From; }
      if (edge.To && !edge.to) { edge.to = edge.To; }
      if (edge.Label && !edge.label) { edge.label = edge.Label; }
      if (edge.Text && !edge.text) { edge.text = edge.Text; }
      if (edge.Reference && !edge.reference) { edge.reference = edge.Reference; }
      
      if (typeof edge.from === "string") {
        if (nameToId[edge.from]) {
          edge.from = nameToId[edge.from].toString();
        } else {
          console.warn("找不到人名 (from):", edge.from);
          edge.from = "";
        }
      }
      if (typeof edge.to === "string") {
        if (nameToId[edge.to]) {
          edge.to = nameToId[edge.to].toString();
        } else {
          console.warn("找不到人名 (to):", edge.to);
          edge.to = "";
        }
      }
      if (edge.accuser && typeof edge.accuser === "string") {
        if (nameToId[edge.accuser]) {
          edge.accuser = nameToId[edge.accuser].toString();
        } else {
          console.warn("找不到人名 (accuser):", edge.accuser);
          edge.accuser = "";
        }
      }
      if (edge.accused && Array.isArray(edge.accused)) {
        edge.accused = edge.accused.map(item => {
          if (typeof item === "string") {
            if (nameToId[item]) {
              return nameToId[item].toString();
            } else {
              console.warn("找不到人名 (accused):", item);
              return "";
            }
          }
          return item;
        });
      }
      return edge;
    });
    return data;
  }

  function getNodeDegrees(edges) {
    const degreeMap = {};
    edges.forEach(e => {
      if (!degreeMap[e.from]) degreeMap[e.from] = 0;
      degreeMap[e.from]++;
      if (!degreeMap[e.to]) degreeMap[e.to] = 0;
      degreeMap[e.to]++;
      if (e.accuser) {
        if (!degreeMap[e.accuser]) degreeMap[e.accuser] = 0;
        degreeMap[e.accuser]++;
      }
      if (e.accused && Array.isArray(e.accused)) {
        e.accused.forEach(id => {
          if (!degreeMap[id]) degreeMap[id] = 0;
          degreeMap[id]++;
        });
      }
    });
    return degreeMap;
  }

  // ---------------------------
  // 繪製網絡圖（同一函式用於指控圖與證供圖）
  // ---------------------------
  function drawGraph(data, elementId, infoPanelId, clickCallback = null, isTestimonyGraph = false) {
    const nodesArray = data.nodes
      ? data.nodes.map(node => ({ ...node, color: getColorByIdentity(node.身份) }))
      : Object.values(peopleData).map(person => ({
          ...person,
          label: person.姓名,
          color: getColorByIdentity(person.身份)
      }));
    
    const relatedIds = new Set(data.edges.flatMap(edge => [edge.from, edge.to, ...(edge.accused || [])]));
    let filteredNodes = nodesArray.filter(node => relatedIds.has(node.id));

    let processedEdges = data.edges;
    if (isTestimonyGraph) {
      processedEdges = preprocessEdges(data.edges);
    }
    const edgesWithIds = processedEdges.map(edge => ({
      ...edge,
      id: edge.edgeId,
      originalData: edge
    }));

    const degreeMap = getNodeDegrees(edgesWithIds);
    filteredNodes = filteredNodes.map(node => ({
      ...node,
      value: degreeMap[node.id] || 0
    }));

    const nodes = new vis.DataSet(filteredNodes);
    const edges = new vis.DataSet(edgesWithIds);
    const container = document.getElementById(elementId);

    const options = {
      nodes: {
        shape: "dot",
        font: { color: "#000", align: "center", size: 20, vadjust: -60 },
        scaling: { min: 35, max: 100 }
      },
      edges: {
        arrows: { to: { enabled: true } },
        length: 350,
        font: { size: 13, multi: "html" },
        smooth: isTestimonyGraph ? false : { enabled: true, type: "dynamic", roundness: 0.2 }
      },
      physics: {
        enabled: true,
        solver: "forceAtlas2Based",
        forceAtlas2Based: { gravitationalConstant: -500, springLength: 100, springConstant: 1, avoidOverlap: 0 },
        stabilization: { iterations: 0, updateInterval: 0 }
      },
      interaction: { zoomView: false, dragView: true }
    };

    const network = new vis.Network(container, { nodes, edges }, options);

    // 保留原先縮放功能：ctrl+滾輪縮放圖表
    container.addEventListener("wheel", function(e) {
      if (e.ctrlKey) {
        e.preventDefault();
        const scaleFactor = 1 - e.deltaY * 0.015;
        const currentScale = network.getScale();
        const newScale = currentScale * scaleFactor;
        network.moveTo({ scale: newScale });
      }
    }, { passive: false });

    network.on("click", function (params) {
      if (isTestimonyGraph) {
        // 新功能：證供圖點擊後僅更新右側資訊，不改變目前顯示的 edges
        if (params.nodes.length > 0) {
          const nodeId = params.nodes[0];
          showPersonInfo(nodeId, infoPanelId);
        } else if (params.edges.length > 0) {
          showTestimonyEdgeInfo(params.edges[0], edges.get(), infoPanelId);
        } else {
          document.getElementById(infoPanelId).innerHTML = "請雙擊人物或關係查看詳細資訊";
        }
        return;
      }
      // 指控圖點擊處理
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0];
        selectedPersonId = nodeId;
        selectedGraphType = "accusation";
        resetButtons();
        resetTestimonyGraph();
        document.getElementById("infoPanelTestimony").innerHTML = "請點擊篩選證供關係按鈕以顯示關係";
        testimonyRelationMode = null;
        showPersonInfo(nodeId, infoPanelId);
        if (clickCallback) clickCallback(nodeId);
      } else if (params.edges.length > 0) {
        selectedPersonId = null;
        selectedGraphType = null;
        resetButtons();
        resetTestimonyGraph();
        showAccusationEdgeInfo(params.edges[0], edges.get(), infoPanelId);
      } else {
        document.getElementById(infoPanelId).innerHTML = "請雙擊人物或關係查看詳細資訊";
      }
    });
    return { nodes, edges, network };
  }

  // ---------------------------
  // 指控圖操作（保持原有功能）
  // ---------------------------
  function filterAccusationGraphByIdentity(identity) {
    const allowedToNodes = Object.values(peopleData)
      .filter(person => person.身份 === identity)
      .map(person => ({
          ...person,
          label: person.姓名,
          color: getColorByIdentity(person.身份)
      }));
    const allowedToIds = new Set(allowedToNodes.map(node => node.id));
    const filteredEdges = fullAccusationData.edges.filter(edge => allowedToIds.has(edge.to));
    const processedEdges = preprocessEdges(filteredEdges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge,
      id: edge.edgeId || `edge-${index}`,
      originalData: edge
    }));
    const allowedNodeIds = new Set();
    filteredEdges.forEach(edge => {
       allowedNodeIds.add(edge.from);
       allowedNodeIds.add(edge.to);
    });
    const filteredNodes = Object.values(peopleData)
         .filter(person => allowedNodeIds.has(person.id))
         .map(person => ({
             ...person,
             label: person.姓名,
             color: getColorByIdentity(person.身份)
         }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
         ...node,
         value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    accusationGraph.network.setData({ nodes, edges });
  }

  function restoreAccusationGraph() {
    const nodesArray = Object.values(peopleData).map(person => ({
         ...person,
         label: person.姓名,
         color: getColorByIdentity(person.身份)
    }));
    const relatedIds = new Set(fullAccusationData.edges.flatMap(edge => [edge.from, edge.to, ...(edge.accused || [])]));
    const filteredNodes = nodesArray.filter(node => relatedIds.has(node.id));
    const processedEdges = preprocessEdges(fullAccusationData.edges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
         ...edge,
         id: edge.edgeId || `edge-${index}`,
         originalData: edge
    }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
         ...node,
         value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    accusationGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 證供圖操作 新功能
  // ---------------------------
  // 當指控圖中選定 node 並按下「作為指控者／被指控者」後，
  // 點擊「篩選證供關係」按鈕依據該 node 及所選 label 過濾 edges。
  function filterTestimonyEdgesByLabelForNode(chosenLabel) {
    let filteredEdges;
    if (chosenLabel === "全部") {
      if (testimonyRelationMode === "accuser") {
        filteredEdges = fullTestimonyData.edges.filter(edge => edge.accuser === selectedPersonId);
      } else if (testimonyRelationMode === "accused") {
        filteredEdges = fullTestimonyData.edges.filter(edge => edge.accused && edge.accused.includes(selectedPersonId));
      }
    } else {
      if (testimonyRelationMode === "accuser") {
        filteredEdges = fullTestimonyData.edges.filter(edge =>
          edge.accuser === selectedPersonId && edge.label === chosenLabel
        );
      } else if (testimonyRelationMode === "accused") {
        filteredEdges = fullTestimonyData.edges.filter(edge =>
          edge.accused && edge.accused.includes(selectedPersonId) && edge.label === chosenLabel
        );
      }
    }
    updateTestimonyGraph(filteredEdges);
  }

  // 全局模式：若未選定指控圖 node或未按下「作為」按鈕，則根據 label 過濾全部 edges
  function filterTestimonyEdgesByLabelForAll(chosenLabel) {
    let filteredEdges;
    if (chosenLabel === "全部") {
      filteredEdges = fullTestimonyData.edges;
    } else {
      filteredEdges = fullTestimonyData.edges.filter(edge => edge.label === chosenLabel);
    }
    updateTestimonyGraph(filteredEdges);
  }

  function updateTestimonyGraph(edgesArr) {
    const processedEdges = preprocessEdges(edgesArr);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge,
      id: edge.edgeId || `edge-${index}`,
      originalData: edge
    }));
    let allowedNodeIds = new Set();
    edgesArr.forEach(edge => {
      allowedNodeIds.add(edge.from);
      allowedNodeIds.add(edge.to);
      if (edge.accuser) allowedNodeIds.add(edge.accuser);
      if (edge.accused && Array.isArray(edge.accused)) {
        edge.accused.forEach(id => allowedNodeIds.add(id));
      }
    });
    const filteredNodes = Object.values(peopleData)
      .filter(person => allowedNodeIds.has(person.id))
      .map(person => ({
        ...person,
        label: person.姓名,
        color: getColorByIdentity(person.身份)
      }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
      ...node,
      value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    testimonyGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 證供圖還原（顯示所有 edges）
  // ---------------------------
  function restoreTestimonyGraph() {
    const nodesArray = fullTestimonyData.nodes
      ? fullTestimonyData.nodes.map(node => ({ ...node, color: getColorByIdentity(node.身份) }))
      : Object.values(peopleData).map(person => ({
          ...person,
          label: person.姓名,
          color: getColorByIdentity(person.身份)
      }));
    const relatedIds = new Set(fullTestimonyData.edges.flatMap(edge => {
      let ids = [];
      if (edge.accuser) ids.push(edge.accuser);
      if (edge.accused && Array.isArray(edge.accused)) ids = ids.concat(edge.accused);
      return ids;
    }));
    const filteredNodes = nodesArray.filter(node => relatedIds.has(node.id));
    const processedEdges = preprocessEdges(fullTestimonyData.edges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge,
      id: edge.edgeId || `edge-${index}`,
      originalData: edge
    }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
      ...node,
      value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    testimonyGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 原有：重置與資訊顯示
  // ---------------------------
  function resetButtons() {
    activeButton = null;
    const btnIds = ["accusedButton", "accuserButton", "showAllButton"];
    btnIds.forEach(id => {
      const btn = document.getElementById(id);
      btn.classList.remove("active");
      btn.style.backgroundColor = "";
    });
  }

  function showPersonInfo(nodeId, infoPanelId) {
    const infoPanel = document.getElementById(infoPanelId);
    const person = peopleData[nodeId];
    if (person) {
      infoPanel.innerHTML = `
        <h3>人物資訊</h3>
        <p><strong>名字：</strong> ${person.姓名 || ""}</p>
        <p><strong>年齡：</strong> ${person.年齡 || "-"}</p>
        <p><strong>種族：</strong> ${person.種族 || "-"}</p>
        <p><strong>籍貫：</strong> ${person.籍貫 || "-"}</p>
        <p><strong>親屬關係：</strong> ${person.親屬關係 || "-"}</p>
        <p><strong>身份：</strong> ${person.身份 || "-"}</p>
        <p><strong>職位：</strong> ${person.職位 || "-"}</p>
        <p><strong>下場：</strong> ${person.下場 || "-"}</p>
        <p><strong>原文：</strong> ${person.原文 || "-"}</p>
        <p><strong>資料來源：</strong> ${person.資料來源 || "-"}</p>
      `;
    } else {
      infoPanel.innerHTML = "<p>❌ 無法找到該人物的詳細資料。</p>";
    }
  }

  function showAccusationEdgeInfo(edgeId, edgesData, infoPanelId) {
    const edge = edgesData.find(edge => edge.id === edgeId);
    const infoPanel = document.getElementById(infoPanelId);
    if (edge) {
      infoPanel.innerHTML = `
        <h3>指控關係資訊</h3>
        <p><strong>關係類型：</strong> ${edge.label || "-"}</p>
      `;
    } else {
      console.error("❌ 無法找到該指控關係資訊，Edge ID:", edgeId);
      infoPanel.innerHTML = "<p>❌ 無法找到該指控關係的詳細資訊。</p>";
    }
  }

  function showTestimonyEdgeInfo(edgeId, edgesData, infoPanelId) {
    console.log("DEBUG: showTestimonyEdgeInfo 被呼叫，edgeId =", edgeId);
    const clickedEdge = edgesData.find(edge => edge.id.toString() === edgeId.toString());
    const infoPanel = document.getElementById(infoPanelId);
    if (clickedEdge && clickedEdge.originalData) {
      const orig = clickedEdge.originalData;
      const accuserName = orig.accuser && peopleData[orig.accuser] ? peopleData[orig.accuser].姓名 : "-";
      const accusedNames = orig.accused
          ? orig.accused.map(id => (peopleData[id] ? peopleData[id].姓名 : "-")).join("、")
          : "";
      infoPanel.innerHTML = `
        <h3>證供關係資訊</h3>
        <p><strong>關係類型：</strong> ${orig.label || "-"}</p>
        <p><strong>作供者：</strong> ${accuserName}</p>
        <p><strong>被供者：</strong> ${accusedNames}</p>
        <p><strong>發生日期：</strong> ${orig.Date || "-"}</p>
        <p><strong>說明：</strong> ${orig.Conclusion || "-"}</p>
        <p><strong>供詞原文：</strong> ${orig.Text || "-"}</p>
        <p><strong>詳細內容：</strong> ${orig.Reference || "-"}</p>
      `;
    } else {
      console.error("❌ 無法找到該證供關係資訊，Edge ID:", edgeId);
      infoPanel.innerHTML = "<p>❌ 無法找到該證供關係的詳細資訊。</p>";
    }
  }

  // ---------------------------
  // 證供關係圖 新功能：篩選按鈕事件
  // ---------------------------
  // 若已在指控圖中選取 node 並按下「作為指控者／被指控者」後，
  // 點擊「篩選證供關係」按鈕，依據該 node 及所選 label 過濾 edges；
  // 否則以全局模式過濾全部 edges。
  document.querySelectorAll(".filter-testimony-button").forEach(btn => {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".filter-testimony-button").forEach(b => b.classList.remove("active"));
      this.classList.add("active");
      const chosenLabel = this.getAttribute("data-label");
      if (selectedPersonId && (testimonyRelationMode === "accuser" || testimonyRelationMode === "accused")) {
        filterTestimonyEdgesByLabelForNode(chosenLabel);
      } else {
        filterTestimonyEdgesByLabelForAll(chosenLabel);
      }
    });
  });

  // ---------------------------
  // 指控關係圖操作
  // ---------------------------
  function filterAccusationGraphByIdentity(identity) {
    const allowedToNodes = Object.values(peopleData)
      .filter(person => person.身份 === identity)
      .map(person => ({
          ...person,
          label: person.姓名,
          color: getColorByIdentity(person.身份)
      }));
    const allowedToIds = new Set(allowedToNodes.map(node => node.id));
    const filteredEdges = fullAccusationData.edges.filter(edge => allowedToIds.has(edge.to));
    const processedEdges = preprocessEdges(filteredEdges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge, 
      id: edge.edgeId || `edge-${index}`,
      originalData: edge 
    }));
    const allowedNodeIds = new Set();
    filteredEdges.forEach(edge => {
       allowedNodeIds.add(edge.from);
       allowedNodeIds.add(edge.to);
    });
    const filteredNodes = Object.values(peopleData)
         .filter(person => allowedNodeIds.has(person.id))
         .map(person => ({
             ...person,
             label: person.姓名,
             color: getColorByIdentity(person.身份)
         }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
         ...node,
         value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    accusationGraph.network.setData({ nodes, edges });
  }

  function restoreAccusationGraph() {
    const nodesArray = Object.values(peopleData).map(person => ({
         ...person,
         label: person.姓名,
         color: getColorByIdentity(person.身份)
    }));
    const relatedIds = new Set(fullAccusationData.edges.flatMap(edge => [edge.from, edge.to, ...(edge.accused || [])]));
    const filteredNodes = nodesArray.filter(node => relatedIds.has(node.id));
    const processedEdges = preprocessEdges(fullAccusationData.edges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
         ...edge,
         id: edge.edgeId || `edge-${index}`,
         originalData: edge
    }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
         ...node,
         value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    accusationGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 證供關係圖：新功能 - 篩選按鈕事件
  // ---------------------------
  function filterTestimonyEdgesByLabelForNode(chosenLabel) {
    let filteredEdges;
    if (chosenLabel === "全部") {
      if (testimonyRelationMode === "accuser") {
        filteredEdges = fullTestimonyData.edges.filter(edge => edge.accuser === selectedPersonId);
      } else if (testimonyRelationMode === "accused") {
        filteredEdges = fullTestimonyData.edges.filter(edge => edge.accused && edge.accused.includes(selectedPersonId));
      }
    } else {
      if (testimonyRelationMode === "accuser") {
        filteredEdges = fullTestimonyData.edges.filter(edge =>
          edge.accuser === selectedPersonId && edge.label === chosenLabel
        );
      } else if (testimonyRelationMode === "accused") {
        filteredEdges = fullTestimonyData.edges.filter(edge =>
          edge.accused && edge.accused.includes(selectedPersonId) && edge.label === chosenLabel
        );
      }
    }
    updateTestimonyGraph(filteredEdges);
  }

  function filterTestimonyEdgesByLabelForAll(chosenLabel) {
    let filteredEdges;
    if (chosenLabel === "全部") {
      filteredEdges = fullTestimonyData.edges;
    } else {
      filteredEdges = fullTestimonyData.edges.filter(edge => edge.label === chosenLabel);
    }
    updateTestimonyGraph(filteredEdges);
  }

  function updateTestimonyGraph(edgesArr) {
    const processedEdges = preprocessEdges(edgesArr);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge,
      id: edge.edgeId || `edge-${index}`,
      originalData: edge
    }));
    let allowedNodeIds = new Set();
    edgesArr.forEach(edge => {
      allowedNodeIds.add(edge.from);
      allowedNodeIds.add(edge.to);
      if(edge.accuser) allowedNodeIds.add(edge.accuser);
      if(edge.accused && Array.isArray(edge.accused)) {
        edge.accused.forEach(id => allowedNodeIds.add(id));
      }
    });
    const filteredNodes = Object.values(peopleData)
      .filter(person => allowedNodeIds.has(person.id))
      .map(person => ({
        ...person,
        label: person.姓名,
        color: getColorByIdentity(person.身份)
      }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
      ...node,
      value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    testimonyGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 還原證供關係圖（顯示全部 edges）
  // ---------------------------
  function restoreTestimonyGraph() {
    const nodesArray = fullTestimonyData.nodes
      ? fullTestimonyData.nodes.map(node => ({ ...node, color: getColorByIdentity(node.身份) }))
      : Object.values(peopleData).map(person => ({
          ...person,
          label: person.姓名,
          color: getColorByIdentity(person.身份)
      }));
    const relatedIds = new Set(fullTestimonyData.edges.flatMap(edge => {
      let ids = [];
      if (edge.accuser) ids.push(edge.accuser);
      if (edge.accused && Array.isArray(edge.accused)) ids = ids.concat(edge.accused);
      return ids;
    }));
    const filteredNodes = nodesArray.filter(node => relatedIds.has(node.id));
    const processedEdges = preprocessEdges(fullTestimonyData.edges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge,
      id: edge.edgeId || `edge-${index}`,
      originalData: edge
    }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
      ...node,
      value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    testimonyGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 原有：重置與資訊顯示
  // ---------------------------
  function resetButtons() {
    activeButton = null;
    const btnIds = ["accusedButton", "accuserButton", "showAllButton"];
    btnIds.forEach(id => {
      const btn = document.getElementById(id);
      btn.classList.remove("active");
      btn.style.backgroundColor = "";
    });
  }

  function showPersonInfo(nodeId, infoPanelId) {
    const infoPanel = document.getElementById(infoPanelId);
    const person = peopleData[nodeId];
    if (person) {
      infoPanel.innerHTML = `
        <h3>人物資訊</h3>
        <p><strong>名字：</strong> ${person.姓名 || ""}</p>
        <p><strong>年齡：</strong> ${person.年齡 || "-"}</p>
        <p><strong>種族：</strong> ${person.種族 || "-"}</p>
        <p><strong>籍貫：</strong> ${person.籍貫 || "-"}</p>
        <p><strong>親屬關係：</strong> ${person.親屬關係 || "-"}</p>
        <p><strong>身份：</strong> ${person.身份 || "-"}</p>
        <p><strong>職位：</strong> ${person.職位 || "-"}</p>
        <p><strong>下場：</strong> ${person.下場 || "-"}</p>
        <p><strong>原文：</strong> ${person.原文 || "-"}</p>
        <p><strong>資料來源：</strong> ${person.資料來源 || "-"}</p>
      `;
    } else {
      infoPanel.innerHTML = "<p>❌ 無法找到該人物的詳細資料。</p>";
    }
  }

  function showAccusationEdgeInfo(edgeId, edgesData, infoPanelId) {
    const edge = edgesData.find(edge => edge.id === edgeId);
    const infoPanel = document.getElementById(infoPanelId);
    if (edge) {
      infoPanel.innerHTML = `
        <h3>指控關係資訊</h3>
        <p><strong>關係類型：</strong> ${edge.label || "-"}</p>
      `;
    } else {
      console.error("❌ 無法找到該指控關係資訊，Edge ID:", edgeId);
      infoPanel.innerHTML = "<p>❌ 無法找到該指控關係的詳細資訊。</p>";
    }
  }

  function showTestimonyEdgeInfo(edgeId, edgesData, infoPanelId) {
    console.log("DEBUG: showTestimonyEdgeInfo 被呼叫，edgeId =", edgeId);
    const clickedEdge = edgesData.find(edge => edge.id.toString() === edgeId.toString());
    const infoPanel = document.getElementById(infoPanelId);
    if (clickedEdge && clickedEdge.originalData) {
      const orig = clickedEdge.originalData;
      const accuserName = orig.accuser && peopleData[orig.accuser] ? peopleData[orig.accuser].姓名 : "-";
      const accusedNames = orig.accused
          ? orig.accused.map(id => (peopleData[id] ? peopleData[id].姓名 : "-")).join("、")
          : "";
      infoPanel.innerHTML = `
        <h3>證供關係資訊</h3>
        <p><strong>關係類型：</strong> ${orig.label || "-"}</p>
        <p><strong>作供者：</strong> ${accuserName}</p>
        <p><strong>被供者：</strong> ${accusedNames}</p>
        <p><strong>發生日期：</strong> ${orig.Date || "-"}</p>
        <p><strong>說明：</strong> ${orig.Conclusion || "-"}</p>
        <p><strong>供詞原文：</strong> ${orig.Text || "-"}</p>
        <p><strong>詳細內容：</strong> ${orig.Reference || "-"}</p>
      `;
    } else {
      console.error("❌ 無法找到該證供關係資訊，Edge ID:", edgeId);
      infoPanel.innerHTML = "<p>❌ 無法找到該證供關係的詳細資訊。</p>";
    }
  }

  // ---------------------------
  // 證供關係圖 新功能：篩選按鈕事件
  // ---------------------------
  // 若在指控圖中選定 node 並按下「作為指控者／被指控者」後，
  // 點擊「篩選證供關係」按鈕依據該 node 與所選 label 過濾出相關 edges；
  // 否則以全局模式根據 label 過濾全部 edges。
  document.querySelectorAll(".filter-testimony-button").forEach(btn => {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".filter-testimony-button").forEach(b => b.classList.remove("active"));
      this.classList.add("active");
      const chosenLabel = this.getAttribute("data-label");
      if (selectedPersonId && (testimonyRelationMode === "accuser" || testimonyRelationMode === "accused")) {
        filterTestimonyEdgesByLabelForNode(chosenLabel);
      } else {
        filterTestimonyEdgesByLabelForAll(chosenLabel);
      }
    });
  });

  // ---------------------------
  // 指控圖操作（原有功能）
  // ---------------------------
  function filterAccusationGraphByIdentity(identity) {
    const allowedToNodes = Object.values(peopleData)
      .filter(person => person.身份 === identity)
      .map(person => ({
          ...person,
          label: person.姓名,
          color: getColorByIdentity(person.身份)
      }));
    const allowedToIds = new Set(allowedToNodes.map(node => node.id));
    const filteredEdges = fullAccusationData.edges.filter(edge => allowedToIds.has(edge.to));
    const processedEdges = preprocessEdges(filteredEdges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge, 
      id: edge.edgeId || `edge-${index}`,
      originalData: edge 
    }));
    const allowedNodeIds = new Set();
    filteredEdges.forEach(edge => {
       allowedNodeIds.add(edge.from);
       allowedNodeIds.add(edge.to);
    });
    const filteredNodes = Object.values(peopleData)
         .filter(person => allowedNodeIds.has(person.id))
         .map(person => ({
             ...person,
             label: person.姓名,
             color: getColorByIdentity(person.身份)
         }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
         ...node,
         value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    accusationGraph.network.setData({ nodes, edges });
  }

  function restoreAccusationGraph() {
    const nodesArray = Object.values(peopleData).map(person => ({
         ...person,
         label: person.姓名,
         color: getColorByIdentity(person.身份)
    }));
    const relatedIds = new Set(fullAccusationData.edges.flatMap(edge => [edge.from, edge.to, ...(edge.accused || [])]));
    const filteredNodes = nodesArray.filter(node => relatedIds.has(node.id));
    const processedEdges = preprocessEdges(fullAccusationData.edges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
         ...edge,
         id: edge.edgeId || `edge-${index}`,
         originalData: edge
    }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
         ...node,
         value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    accusationGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 證供圖操作：新功能
  // ---------------------------
  function filterTestimonyEdgesByLabelForNode(chosenLabel) {
    let filteredEdges;
    if (chosenLabel === "全部") {
      if (testimonyRelationMode === "accuser") {
        filteredEdges = fullTestimonyData.edges.filter(edge => edge.accuser === selectedPersonId);
      } else if (testimonyRelationMode === "accused") {
        filteredEdges = fullTestimonyData.edges.filter(edge => edge.accused && edge.accused.includes(selectedPersonId));
      }
    } else {
      if (testimonyRelationMode === "accuser") {
        filteredEdges = fullTestimonyData.edges.filter(edge =>
          edge.accuser === selectedPersonId && edge.label === chosenLabel
        );
      } else if (testimonyRelationMode === "accused") {
        filteredEdges = fullTestimonyData.edges.filter(edge =>
          edge.accused && edge.accused.includes(selectedPersonId) && edge.label === chosenLabel
        );
      }
    }
    updateTestimonyGraph(filteredEdges);
  }

  function filterTestimonyEdgesByLabelForAll(chosenLabel) {
    let filteredEdges;
    if (chosenLabel === "全部") {
      filteredEdges = fullTestimonyData.edges;
    } else {
      filteredEdges = fullTestimonyData.edges.filter(edge => edge.label === chosenLabel);
    }
    updateTestimonyGraph(filteredEdges);
  }

  function updateTestimonyGraph(edgesArr) {
    const processedEdges = preprocessEdges(edgesArr);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge,
      id: edge.edgeId || `edge-${index}`,
      originalData: edge
    }));
    let allowedNodeIds = new Set();
    edgesArr.forEach(edge => {
      allowedNodeIds.add(edge.from);
      allowedNodeIds.add(edge.to);
      if (edge.accuser) allowedNodeIds.add(edge.accuser);
      if (edge.accused && Array.isArray(edge.accused)) {
        edge.accused.forEach(id => allowedNodeIds.add(id));
      }
    });
    const filteredNodes = Object.values(peopleData)
      .filter(person => allowedNodeIds.has(person.id))
      .map(person => ({
        ...person,
        label: person.姓名,
        color: getColorByIdentity(person.身份)
      }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
      ...node,
      value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    testimonyGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 還原證供圖（顯示全部 edges）
  // ---------------------------
  function restoreTestimonyGraph() {
    const nodesArray = fullTestimonyData.nodes
      ? fullTestimonyData.nodes.map(node => ({ ...node, color: getColorByIdentity(node.身份) }))
      : Object.values(peopleData).map(person => ({
          ...person,
          label: person.姓名,
          color: getColorByIdentity(person.身份)
      }));
    const relatedIds = new Set(fullTestimonyData.edges.flatMap(edge => {
      let ids = [];
      if (edge.accuser) ids.push(edge.accuser);
      if (edge.accused && Array.isArray(edge.accused)) ids = ids.concat(edge.accused);
      return ids;
    }));
    const filteredNodes = nodesArray.filter(node => relatedIds.has(node.id));
    const processedEdges = preprocessEdges(fullTestimonyData.edges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge,
      id: edge.edgeId || `edge-${index}`,
      originalData: edge
    }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
      ...node,
      value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    testimonyGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 原有：重置與資訊顯示
  // ---------------------------
  function resetButtons() {
    activeButton = null;
    const btnIds = ["accusedButton", "accuserButton", "showAllButton"];
    btnIds.forEach(id => {
      const btn = document.getElementById(id);
      btn.classList.remove("active");
      btn.style.backgroundColor = "";
    });
  }

  function showPersonInfo(nodeId, infoPanelId) {
    const infoPanel = document.getElementById(infoPanelId);
    const person = peopleData[nodeId];
    if (person) {
      infoPanel.innerHTML = `
        <h3>人物資訊</h3>
        <p><strong>名字：</strong> ${person.姓名 || ""}</p>
        <p><strong>年齡：</strong> ${person.年齡 || "-"}</p>
        <p><strong>種族：</strong> ${person.種族 || "-"}</p>
        <p><strong>籍貫：</strong> ${person.籍貫 || "-"}</p>
        <p><strong>親屬關係：</strong> ${person.親屬關係 || "-"}</p>
        <p><strong>身份：</strong> ${person.身份 || "-"}</p>
        <p><strong>職位：</strong> ${person.職位 || "-"}</p>
        <p><strong>下場：</strong> ${person.下場 || "-"}</p>
        <p><strong>原文：</strong> ${person.原文 || "-"}</p>
        <p><strong>資料來源：</strong> ${person.資料來源 || "-"}</p>
      `;
    } else {
      infoPanel.innerHTML = "<p>❌ 無法找到該人物的詳細資料。</p>";
    }
  }

  function showAccusationEdgeInfo(edgeId, edgesData, infoPanelId) {
    const edge = edgesData.find(edge => edge.id === edgeId);
    const infoPanel = document.getElementById(infoPanelId);
    if (edge) {
      infoPanel.innerHTML = `
        <h3>指控關係資訊</h3>
        <p><strong>關係類型：</strong> ${edge.label || "-"}</p>
      `;
    } else {
      console.error("❌ 無法找到該指控關係資訊，Edge ID:", edgeId);
      infoPanel.innerHTML = "<p>❌ 無法找到該指控關係的詳細資訊。</p>";
    }
  }

  function showTestimonyEdgeInfo(edgeId, edgesData, infoPanelId) {
    console.log("DEBUG: showTestimonyEdgeInfo 被呼叫，edgeId =", edgeId);
    const clickedEdge = edgesData.find(edge => edge.id.toString() === edgeId.toString());
    const infoPanel = document.getElementById(infoPanelId);
    if (clickedEdge && clickedEdge.originalData) {
      const orig = clickedEdge.originalData;
      const accuserName = orig.accuser && peopleData[orig.accuser] ? peopleData[orig.accuser].姓名 : "-";
      const accusedNames = orig.accused
          ? orig.accused.map(id => (peopleData[id] ? peopleData[id].姓名 : "-")).join("、")
          : "";
      infoPanel.innerHTML = `
        <h3>證供關係資訊</h3>
        <p><strong>關係類型：</strong> ${orig.label || "-"}</p>
        <p><strong>作供者：</strong> ${accuserName}</p>
        <p><strong>被供者：</strong> ${accusedNames}</p>
        <p><strong>發生日期：</strong> ${orig.Date || "-"}</p>
        <p><strong>說明：</strong> ${orig.Conclusion || "-"}</p>
        <p><strong>供詞原文：</strong> ${orig.Text || "-"}</p>
        <p><strong>詳細內容：</strong> ${orig.Reference || "-"}</p>
      `;
    } else {
      console.error("❌ 無法找到該證供關係資訊，Edge ID:", edgeId);
      infoPanel.innerHTML = "<p>❌ 無法找到該證供關係的詳細資訊。</p>";
    }
  }

  // ---------------------------
  // 證供圖新功能：篩選按鈕事件
  // ---------------------------
  document.querySelectorAll(".filter-testimony-button").forEach(btn => {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".filter-testimony-button").forEach(b => b.classList.remove("active"));
      this.classList.add("active");
      const chosenLabel = this.getAttribute("data-label");
      if (selectedPersonId && (testimonyRelationMode === "accuser" || testimonyRelationMode === "accused")) {
        filterTestimonyEdgesByLabelForNode(chosenLabel);
      } else {
        filterTestimonyEdgesByLabelForAll(chosenLabel);
      }
    });
  });

  // ---------------------------
  // 指控圖操作（保持原有功能）
  // ---------------------------
  function filterAccusationGraphByIdentity(identity) {
    const allowedToNodes = Object.values(peopleData)
      .filter(person => person.身份 === identity)
      .map(person => ({
          ...person,
          label: person.姓名,
          color: getColorByIdentity(person.身份)
      }));
    const allowedToIds = new Set(allowedToNodes.map(node => node.id));
    const filteredEdges = fullAccusationData.edges.filter(edge => allowedToIds.has(edge.to));
    const processedEdges = preprocessEdges(filteredEdges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge, 
      id: edge.edgeId || `edge-${index}`,
      originalData: edge 
    }));
    const allowedNodeIds = new Set();
    filteredEdges.forEach(edge => {
       allowedNodeIds.add(edge.from);
       allowedNodeIds.add(edge.to);
    });
    const filteredNodes = Object.values(peopleData)
         .filter(person => allowedNodeIds.has(person.id))
         .map(person => ({
             ...person,
             label: person.姓名,
             color: getColorByIdentity(person.身份)
         }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
         ...node,
         value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    accusationGraph.network.setData({ nodes, edges });
  }

  function restoreAccusationGraph() {
    const nodesArray = Object.values(peopleData).map(person => ({
         ...person,
         label: person.姓名,
         color: getColorByIdentity(person.身份)
    }));
    const relatedIds = new Set(fullAccusationData.edges.flatMap(edge => [edge.from, edge.to, ...(edge.accused || [])]));
    const filteredNodes = nodesArray.filter(node => relatedIds.has(node.id));
    const processedEdges = preprocessEdges(fullAccusationData.edges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
         ...edge,
         id: edge.edgeId || `edge-${index}`,
         originalData: edge
    }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
         ...node,
         value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    accusationGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 證供圖操作：新功能
  // ---------------------------
  function filterTestimonyEdgesByLabelForNode(chosenLabel) {
    let filteredEdges;
    if (chosenLabel === "全部") {
      if (testimonyRelationMode === "accuser") {
        filteredEdges = fullTestimonyData.edges.filter(edge => edge.accuser === selectedPersonId);
      } else if (testimonyRelationMode === "accused") {
        filteredEdges = fullTestimonyData.edges.filter(edge => edge.accused && edge.accused.includes(selectedPersonId));
      }
    } else {
      if (testimonyRelationMode === "accuser") {
        filteredEdges = fullTestimonyData.edges.filter(edge =>
          edge.accuser === selectedPersonId && edge.label === chosenLabel
        );
      } else if (testimonyRelationMode === "accused") {
        filteredEdges = fullTestimonyData.edges.filter(edge =>
          edge.accused && edge.accused.includes(selectedPersonId) && edge.label === chosenLabel
        );
      }
    }
    updateTestimonyGraph(filteredEdges);
  }

  function filterTestimonyEdgesByLabelForAll(chosenLabel) {
    let filteredEdges;
    if (chosenLabel === "全部") {
      filteredEdges = fullTestimonyData.edges;
    } else {
      filteredEdges = fullTestimonyData.edges.filter(edge => edge.label === chosenLabel);
    }
    updateTestimonyGraph(filteredEdges);
  }

  function updateTestimonyGraph(edgesArr) {
    const processedEdges = preprocessEdges(edgesArr);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge,
      id: edge.edgeId || `edge-${index}`,
      originalData: edge
    }));
    let allowedNodeIds = new Set();
    edgesArr.forEach(edge => {
      allowedNodeIds.add(edge.from);
      allowedNodeIds.add(edge.to);
      if (edge.accuser) allowedNodeIds.add(edge.accuser);
      if (edge.accused && Array.isArray(edge.accused)) {
        edge.accused.forEach(id => allowedNodeIds.add(id));
      }
    });
    const filteredNodes = Object.values(peopleData)
      .filter(person => allowedNodeIds.has(person.id))
      .map(person => ({
        ...person,
        label: person.姓名,
        color: getColorByIdentity(person.身份)
      }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
      ...node,
      value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    testimonyGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 證供圖還原：顯示全部 edges
  // ---------------------------
  function restoreTestimonyGraph() {
    const nodesArray = fullTestimonyData.nodes
      ? fullTestimonyData.nodes.map(node => ({ ...node, color: getColorByIdentity(node.身份) }))
      : Object.values(peopleData).map(person => ({
          ...person,
          label: person.姓名,
          color: getColorByIdentity(person.身份)
      }));
    const relatedIds = new Set(fullTestimonyData.edges.flatMap(edge => {
      let ids = [];
      if (edge.accuser) ids.push(edge.accuser);
      if (edge.accused && Array.isArray(edge.accused)) ids = ids.concat(edge.accused);
      return ids;
    }));
    const filteredNodes = nodesArray.filter(node => relatedIds.has(node.id));
    const processedEdges = preprocessEdges(fullTestimonyData.edges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge,
      id: edge.edgeId || `edge-${index}`,
      originalData: edge
    }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
      ...node,
      value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    testimonyGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 原有：重置與資訊顯示
  // ---------------------------
  function resetButtons() {
    activeButton = null;
    const btnIds = ["accusedButton", "accuserButton", "showAllButton"];
    btnIds.forEach(id => {
      const btn = document.getElementById(id);
      btn.classList.remove("active");
      btn.style.backgroundColor = "";
    });
  }

  function showPersonInfo(nodeId, infoPanelId) {
    const infoPanel = document.getElementById(infoPanelId);
    const person = peopleData[nodeId];
    if (person) {
      infoPanel.innerHTML = `
        <h3>人物資訊</h3>
        <p><strong>名字：</strong> ${person.姓名 || ""}</p>
        <p><strong>年齡：</strong> ${person.年齡 || "-"}</p>
        <p><strong>種族：</strong> ${person.種族 || "-"}</p>
        <p><strong>籍貫：</strong> ${person.籍貫 || "-"}</p>
        <p><strong>親屬關係：</strong> ${person.親屬關係 || "-"}</p>
        <p><strong>職位：</strong> ${person.職位 || "-"}</p>
        <p><strong>原文：</strong> ${person.原文 || "-"}</p>
        <p><strong>資料來源：</strong> ${person.資料來源 || "-"}</p>
      `;
    } else {
      infoPanel.innerHTML = "<p>❌ 無法找到該人物的詳細資料。</p>";
    }
  }

  function showAccusationEdgeInfo(edgeId, edgesData, infoPanelId) {
    const edge = edgesData.find(edge => edge.id === edgeId);
    const infoPanel = document.getElementById(infoPanelId);
    if (edge) {
      infoPanel.innerHTML = `
        <h3>指控關係資訊</h3>
        <p><strong>關係類型：</strong> ${edge.label || "-"}</p>
      `;
    } else {
      console.error("❌ 無法找到該指控關係資訊，Edge ID:", edgeId);
      infoPanel.innerHTML = "<p>❌ 無法找到該指控關係的詳細資訊。</p>";
    }
  }

  function showTestimonyEdgeInfo(edgeId, edgesData, infoPanelId) {
    console.log("DEBUG: showTestimonyEdgeInfo 被呼叫，edgeId =", edgeId);
    const clickedEdge = edgesData.find(edge => edge.id.toString() === edgeId.toString());
    const infoPanel = document.getElementById(infoPanelId);
    if (clickedEdge && clickedEdge.originalData) {
      const orig = clickedEdge.originalData;
      const accuserName = orig.accuser && peopleData[orig.accuser] ? peopleData[orig.accuser].姓名 : "-";
      const accusedNames = orig.accused
          ? orig.accused.map(id => (peopleData[id] ? peopleData[id].姓名 : "-")).join("、")
          : "";
      infoPanel.innerHTML = `
        <h3>證供關係資訊</h3>
        <p><strong>關係類型：</strong> ${orig.label || "-"}</p>
        <p><strong>作供者：</strong> ${accuserName}</p>
        <p><strong>被供者：</strong> ${accusedNames}</p>
        <p><strong>發生日期：</strong> ${orig.Date || "-"}</p>
        <p><strong>說明：</strong> ${orig.Conclusion || "-"}</p>
        <p><strong>供詞原文：</strong> ${orig.Text || "-"}</p>
        <p><strong>詳細內容：</strong> ${orig.Reference || "-"}</p>
      `;
    } else {
      console.error("❌ 無法找到該證供關係資訊，Edge ID:", edgeId);
      infoPanel.innerHTML = "<p>❌ 無法找到該證供關係的詳細資訊。</p>";
    }
  }

  // ---------------------------
  // 證供圖新功能：篩選按鈕事件
  // ---------------------------
  document.querySelectorAll(".filter-testimony-button").forEach(btn => {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".filter-testimony-button").forEach(b => b.classList.remove("active"));
      this.classList.add("active");
      const chosenLabel = this.getAttribute("data-label");
      if (selectedPersonId && (testimonyRelationMode === "accuser" || testimonyRelationMode === "accused")) {
        filterTestimonyEdgesByLabelForNode(chosenLabel);
      } else {
        filterTestimonyEdgesByLabelForAll(chosenLabel);
      }
    });
  });

  // ---------------------------
  // 指控圖操作（原有功能保持）
  // ---------------------------
  function filterAccusationGraphByIdentity(identity) {
    const allowedToNodes = Object.values(peopleData)
      .filter(person => person.身份 === identity)
      .map(person => ({
          ...person,
          label: person.姓名,
          color: getColorByIdentity(person.身份)
      }));
    const allowedToIds = new Set(allowedToNodes.map(node => node.id));
    const filteredEdges = fullAccusationData.edges.filter(edge => allowedToIds.has(edge.to));
    const processedEdges = preprocessEdges(filteredEdges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge, 
      id: edge.edgeId || `edge-${index}`,
      originalData: edge 
    }));
    const allowedNodeIds = new Set();
    filteredEdges.forEach(edge => {
       allowedNodeIds.add(edge.from);
       allowedNodeIds.add(edge.to);
    });
    const filteredNodes = Object.values(peopleData)
         .filter(person => allowedNodeIds.has(person.id))
         .map(person => ({
             ...person,
             label: person.姓名,
             color: getColorByIdentity(person.身份)
         }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
         ...node,
         value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    accusationGraph.network.setData({ nodes, edges });
  }

  function restoreAccusationGraph() {
    const nodesArray = Object.values(peopleData).map(person => ({
         ...person,
         label: person.姓名,
         color: getColorByIdentity(person.身份)
    }));
    const relatedIds = new Set(fullAccusationData.edges.flatMap(edge => [edge.from, edge.to, ...(edge.accused || [])]));
    const filteredNodes = nodesArray.filter(node => relatedIds.has(node.id));
    const processedEdges = preprocessEdges(fullAccusationData.edges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
         ...edge,
         id: edge.edgeId || `edge-${index}`,
         originalData: edge
    }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
         ...node,
         value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    accusationGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 證供圖操作：新功能
  // ---------------------------
  function filterTestimonyEdgesByLabelForNode(chosenLabel) {
    let filteredEdges;
    if (chosenLabel === "全部") {
      if (testimonyRelationMode === "accuser") {
        filteredEdges = fullTestimonyData.edges.filter(edge => edge.accuser === selectedPersonId);
      } else if (testimonyRelationMode === "accused") {
        filteredEdges = fullTestimonyData.edges.filter(edge => edge.accused && edge.accused.includes(selectedPersonId));
      }
    } else {
      if (testimonyRelationMode === "accuser") {
        filteredEdges = fullTestimonyData.edges.filter(edge =>
          edge.accuser === selectedPersonId && edge.label === chosenLabel
        );
      } else if (testimonyRelationMode === "accused") {
        filteredEdges = fullTestimonyData.edges.filter(edge =>
          edge.accused && edge.accused.includes(selectedPersonId) && edge.label === chosenLabel
        );
      }
    }
    updateTestimonyGraph(filteredEdges);
  }

  function filterTestimonyEdgesByLabelForAll(chosenLabel) {
    let filteredEdges;
    if (chosenLabel === "全部") {
      filteredEdges = fullTestimonyData.edges;
    } else {
      filteredEdges = fullTestimonyData.edges.filter(edge => edge.label === chosenLabel);
    }
    updateTestimonyGraph(filteredEdges);
  }

  function updateTestimonyGraph(edgesArr) {
    const processedEdges = preprocessEdges(edgesArr);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge,
      id: edge.edgeId || `edge-${index}`,
      originalData: edge
    }));
    let allowedNodeIds = new Set();
    edgesArr.forEach(edge => {
      allowedNodeIds.add(edge.from);
      allowedNodeIds.add(edge.to);
      if (edge.accuser) allowedNodeIds.add(edge.accuser);
      if (edge.accused && Array.isArray(edge.accused)) {
        edge.accused.forEach(id => allowedNodeIds.add(id));
      }
    });
    const filteredNodes = Object.values(peopleData)
      .filter(person => allowedNodeIds.has(person.id))
      .map(person => ({
        ...person,
        label: person.姓名,
        color: getColorByIdentity(person.身份)
      }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
      ...node,
      value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    testimonyGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 證供圖還原（顯示全部 edges）
  // ---------------------------
  function restoreTestimonyGraph() {
    const nodesArray = fullTestimonyData.nodes
      ? fullTestimonyData.nodes.map(node => ({ ...node, color: getColorByIdentity(node.身份) }))
      : Object.values(peopleData).map(person => ({
          ...person,
          label: person.姓名,
          color: getColorByIdentity(person.身份)
      }));
    const relatedIds = new Set(fullTestimonyData.edges.flatMap(edge => {
      let ids = [];
      if (edge.accuser) ids.push(edge.accuser);
      if (edge.accused && Array.isArray(edge.accused)) ids = ids.concat(edge.accused);
      return ids;
    }));
    const filteredNodes = nodesArray.filter(node => relatedIds.has(node.id));
    const processedEdges = preprocessEdges(fullTestimonyData.edges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge,
      id: edge.edgeId || `edge-${index}`,
      originalData: edge
    }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
      ...node,
      value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    testimonyGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 原有：重置與資訊顯示
  // ---------------------------
  function resetButtons() {
    activeButton = null;
    const btnIds = ["accusedButton", "accuserButton", "showAllButton"];
    btnIds.forEach(id => {
      const btn = document.getElementById(id);
      btn.classList.remove("active");
      btn.style.backgroundColor = "";
    });
  }

  function showPersonInfo(nodeId, infoPanelId) {
    const infoPanel = document.getElementById(infoPanelId);
    const person = peopleData[nodeId];
    if (person) {
      infoPanel.innerHTML = `
        <h3>人物資訊</h3>
        <p><strong>名字：</strong> ${person.姓名 || ""}</p>
        <p><strong>年齡：</strong> ${person.年齡 || "-"}</p>
        <p><strong>種族：</strong> ${person.種族 || "-"}</p>
        <p><strong>籍貫：</strong> ${person.籍貫 || "-"}</p>
        <p><strong>親屬關係：</strong> ${person.親屬關係 || "-"}</p>
        <p><strong>職位：</strong> ${person.職位 || "-"}</p>
        <p><strong>原文：</strong> ${person.原文 || "-"}</p>
        <p><strong>資料來源：</strong> ${person.資料來源 || "-"}</p>
      `;
    } else {
      infoPanel.innerHTML = "<p>❌ 無法找到該人物的詳細資料。</p>";
    }
  }

  function showAccusationEdgeInfo(edgeId, edgesData, infoPanelId) {
    const edge = edgesData.find(edge => edge.id === edgeId);
    const infoPanel = document.getElementById(infoPanelId);
    if (edge) {
      infoPanel.innerHTML = `
        <h3>指控關係資訊</h3>
        <p><strong>關係類型：</strong> ${edge.label || "-"}</p>
      `;
    } else {
      console.error("❌ 無法找到該指控關係資訊，Edge ID:", edgeId);
      infoPanel.innerHTML = "<p>❌ 無法找到該指控關係的詳細資訊。</p>";
    }
  }

  function showTestimonyEdgeInfo(edgeId, edgesData, infoPanelId) {
    console.log("DEBUG: showTestimonyEdgeInfo 被呼叫，edgeId =", edgeId);
    const clickedEdge = edgesData.find(edge => edge.id.toString() === edgeId.toString());
    const infoPanel = document.getElementById(infoPanelId);
    if (clickedEdge && clickedEdge.originalData) {
      const orig = clickedEdge.originalData;
      const accuserName = orig.accuser && peopleData[orig.accuser] ? peopleData[orig.accuser].姓名 : "-";
      const accusedNames = orig.accused
          ? orig.accused.map(id => (peopleData[id] ? peopleData[id].姓名 : "-")).join("、")
          : "";
      infoPanel.innerHTML = `
        <h3>證供關係資訊</h3>
        <p><strong>關係類型：</strong> ${orig.label || "-"}</p>
        <p><strong>作供者：</strong> ${accuserName}</p>
        <p><strong>被供者：</strong> ${accusedNames}</p>
        <p><strong>發生日期：</strong> ${orig.Date || "-"}</p>
        <p><strong>說明：</strong> ${orig.Conclusion || "-"}</p>
        <p><strong>供詞原文：</strong> ${orig.Text || "-"}</p>
        <p><strong>詳細內容：</strong> ${orig.Reference || "-"}</p>
      `;
    } else {
      console.error("❌ 無法找到該證供關係資訊，Edge ID:", edgeId);
      infoPanel.innerHTML = "<p>❌ 無法找到該證供關係的詳細資訊。</p>";
    }
  }

  // ---------------------------
  // 證供圖 新功能：當指控圖中選定 node 並按下「作為指控者／被指控者」後，
  // 點擊「篩選證供關係」按鈕依據所選 label 過濾出相關 edges；
  // 若未選定 node，則以全局模式過濾
  document.querySelectorAll(".filter-testimony-button").forEach(btn => {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".filter-testimony-button").forEach(b => b.classList.remove("active"));
      this.classList.add("active");
      const chosenLabel = this.getAttribute("data-label");
      if (selectedPersonId && (testimonyRelationMode === "accuser" || testimonyRelationMode === "accused")) {
        filterTestimonyEdgesByLabelForNode(chosenLabel);
      } else {
        filterTestimonyEdgesByLabelForAll(chosenLabel);
      }
    });
  });

  // ---------------------------
  // 指控圖「作為指控者」／「作為被指控者」按鈕事件
  // ---------------------------
  document.getElementById("accusedButton").addEventListener("click", function () {
    if (!selectedPersonId) return;
    testimonyRelationMode = "accused";
    this.classList.add("active");
    this.style.backgroundColor = "red";
    document.getElementById("accuserButton").classList.remove("active");
    document.getElementById("accuserButton").style.backgroundColor = "";
    document.getElementById("showAllButton").classList.remove("active");
    document.getElementById("showAllButton").style.backgroundColor = "";
    activeButton = "accused";
    testimonyDisplayMode = "normal";
    resetTestimonyGraph();
    document.getElementById("infoPanelTestimony").innerHTML = "請點擊篩選證供關係按鈕以顯示關係";
  });

  document.getElementById("accuserButton").addEventListener("click", function () {
    if (!selectedPersonId) return;
    testimonyRelationMode = "accuser";
    this.classList.add("active");
    this.style.backgroundColor = "red";
    document.getElementById("accusedButton").classList.remove("active");
    document.getElementById("accusedButton").style.backgroundColor = "";
    document.getElementById("showAllButton").classList.remove("active");
    document.getElementById("showAllButton").style.backgroundColor = "";
    activeButton = "accuser";
    testimonyDisplayMode = "normal";
    resetTestimonyGraph();
    document.getElementById("infoPanelTestimony").innerHTML = "請點擊篩選證供關係按鈕以顯示關係";
  });

  // ---------------------------
  // 「顯示所有證供關係」按鈕事件：直接還原全圖（不受 node 選取影響）
  // ---------------------------
  document.getElementById("showAllButton").addEventListener("click", function () {
    selectedPersonId = null;
    selectedGraphType = null;
    testimonyRelationMode = null;
    this.classList.add("active");
    this.style.backgroundColor = "red";
    document.getElementById("accusedButton").classList.remove("active");
    document.getElementById("accusedButton").style.backgroundColor = "";
    document.getElementById("accuserButton").classList.remove("active");
    document.getElementById("accuserButton").style.backgroundColor = "";
    activeButton = "showAll";
    restoreTestimonyGraph();
  });

  // ---------------------------
  // 證供圖點擊事件：更新資訊面板，但不改變顯示的 edges
  // ---------------------------
  // 注意：drawGraph 中對 isTestimonyGraph 為 true 時，將不更新網絡資料，只更新資訊面板。
  // 已在 drawGraph 內部增加判斷，不改變 testimonyGraph 的數據。

  // ---------------------------
  // 證供圖還原（顯示全部）
  // ---------------------------
  function resetTestimonyGraph() {
    const nodes = new vis.DataSet([]);
    const edges = new vis.DataSet([]);
    testimonyGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 證供圖還原（顯示全部 edges）
  // ---------------------------
  function showAllTestimonyGraphAccusedOnly() {
    testimonyDisplayMode = "allAccusedOnly";
    let accusedSet = new Set();
    fullTestimonyData.edges.forEach(edge => {
      if (edge.accused) {
        edge.accused.forEach(id => accusedSet.add(id));
      }
    });
    const nodesArray = fullTestimonyData.nodes
      ? fullTestimonyData.nodes.map(node => ({ ...node, color: getColorByIdentity(node.身份) }))
      : Object.values(peopleData).map(person => ({
            ...person,
            label: person.姓名,
            color: getColorByIdentity(person.身份)
         }));
    const filteredNodes = nodesArray.filter(node => accusedSet.has(node.id));
    let filteredEdges = fullTestimonyData.edges;
    filteredEdges = preprocessEdges(filteredEdges);
    const filteredEdgesWithIds = filteredEdges.map(edge => ({ 
      ...edge, 
      id: edge.edgeId,
      originalData: edge 
    }))
    .filter(edge => edge.accused && edge.accused.some(id => accusedSet.has(id)));
    const nodes = new vis.DataSet(filteredNodes);
    const edges = new vis.DataSet(filteredEdgesWithIds);
    testimonyGraph.network.setData({ nodes, edges });
    document.getElementById("infoPanelTestimony").innerHTML = "請點擊人物或關係查看詳細資訊";
  }

  // ---------------------------
  // 證供圖還原（顯示全部 edges）原有功能
  // ---------------------------
  function restoreTestimonyGraph() {
    const nodesArray = fullTestimonyData.nodes
      ? fullTestimonyData.nodes.map(node => ({ ...node, color: getColorByIdentity(node.身份) }))
      : Object.values(peopleData).map(person => ({
          ...person,
          label: person.姓名,
          color: getColorByIdentity(person.身份)
      }));
    const relatedIds = new Set(fullTestimonyData.edges.flatMap(edge => {
      let ids = [];
      if (edge.accuser) ids.push(edge.accuser);
      if (edge.accused && Array.isArray(edge.accused)) ids = ids.concat(edge.accused);
      return ids;
    }));
    const filteredNodes = nodesArray.filter(node => relatedIds.has(node.id));
    const processedEdges = preprocessEdges(fullTestimonyData.edges);
    const edgesWithIds = processedEdges.map((edge, index) => ({
      ...edge,
      id: edge.edgeId || `edge-${index}`,
      originalData: edge
    }));
    const degreeMap = getNodeDegrees(edgesWithIds);
    const finalNodes = filteredNodes.map(node => ({
      ...node,
      value: degreeMap[node.id] || 0
    }));
    const nodes = new vis.DataSet(finalNodes);
    const edges = new vis.DataSet(edgesWithIds);
    testimonyGraph.network.setData({ nodes, edges });
  }

  // ---------------------------
  // 載入數據
  // ---------------------------
  async function loadData() {
    peopleData = await fetchPeopleData();
    console.log("✅ 人物數據加載完成:", peopleData);
    const nameToId = {};
    Object.keys(peopleData).forEach(id => {
      const person = peopleData[id];
      nameToId[person.姓名] = id;
    });
    // 取得指控關係資料
    fetch(`${API_BASE_URL}/api/accusation-relationships`)
      .then(response => response.json())
      .then(data => {
        data = convertRelationshipData(data, nameToId);
        data.edges = data.edges.map((edge, index) => ({ ...edge, edgeId: `edge-${index}` }));
        fullAccusationData = data;
        accusationGraph = drawGraph(data, "accusationGraph", "infoPanel", null, false);
      })
      .catch(error => console.error("❌ 指控關係數據載入錯誤:", error));
    // 取得證供關係資料
    fetch(`${API_BASE_URL}/api/testimony-relationships`)
      .then(response => response.json())
      .then(data => {
        data = convertRelationshipData(data, nameToId);
        data.edges = data.edges.map((edge, index) => ({ ...edge, edgeId: `edge-${index}` }));
        fullTestimonyData = data;
        testimonyGraph = drawGraph(data, "testimonyGraph", "infoPanelTestimony", null, true);
      })
      .catch(error => console.error("❌ 證供關係數據載入錯誤:", error));
  }

  loadData();

  // ---------------------------
  // 綁定指控圖身份篩選按鈕事件
  // ---------------------------
  const identityButtons = document.querySelectorAll(".filter-identity-button");
  identityButtons.forEach(button => {
    button.addEventListener("click", function () {
      identityButtons.forEach(btn => btn.classList.remove("active"));
      this.classList.add("active");
      const identity = this.getAttribute("data-identity");
      if (identity === "全部") {
        restoreAccusationGraph();
      } else {
        filterAccusationGraphByIdentity(identity);
      }
    });
  });

  // ---------------------------
  // 綁定證供圖篩選按鈕事件
  // ---------------------------
  const testimonyButtons = document.querySelectorAll(".filter-testimony-button");
  testimonyButtons.forEach(button => {
    button.addEventListener("click", function () {
      testimonyButtons.forEach(btn => btn.classList.remove("active"));
      this.classList.add("active");
      const chosenLabel = this.getAttribute("data-label");
      if (selectedPersonId && (testimonyRelationMode === "accuser" || testimonyRelationMode === "accused")) {
        filterTestimonyEdgesByLabelForNode(chosenLabel);
      } else {
        filterTestimonyEdgesByLabelForAll(chosenLabel);
      }
    });
  });

  // ---------------------------
  // 綁定指控圖「作為指控者」／「作為被指控者」按鈕事件
  // ---------------------------
  document.getElementById("accusedButton").addEventListener("click", function () {
    if (!selectedPersonId) return;
    testimonyRelationMode = "accused";
    this.classList.add("active");
    this.style.backgroundColor = "red";
    document.getElementById("accuserButton").classList.remove("active");
    document.getElementById("accuserButton").style.backgroundColor = "";
    document.getElementById("showAllButton").classList.remove("active");
    document.getElementById("showAllButton").style.backgroundColor = "";
    activeButton = "accused";
    testimonyDisplayMode = "normal";
    resetTestimonyGraph();
    document.getElementById("infoPanelTestimony").innerHTML = "請點擊篩選證供關係按鈕以顯示關係";
  });

  document.getElementById("accuserButton").addEventListener("click", function () {
    if (!selectedPersonId) return;
    testimonyRelationMode = "accuser";
    this.classList.add("active");
    this.style.backgroundColor = "red";
    document.getElementById("accusedButton").classList.remove("active");
    document.getElementById("accusedButton").style.backgroundColor = "";
    document.getElementById("showAllButton").classList.remove("active");
    document.getElementById("showAllButton").style.backgroundColor = "";
    activeButton = "accuser";
    testimonyDisplayMode = "normal";
    resetTestimonyGraph();
    document.getElementById("infoPanelTestimony").innerHTML = "請點擊篩選證供關係按鈕以顯示關係";
  });

  // ---------------------------
  // 綁定「顯示所有證供關係」按鈕事件：無論狀態均還原全圖
  // ---------------------------
  document.getElementById("showAllButton").addEventListener("click", function () {
    selectedPersonId = null;
    selectedGraphType = null;
    testimonyRelationMode = null;
    this.classList.add("active");
    this.style.backgroundColor = "red";
    document.getElementById("accusedButton").classList.remove("active");
    document.getElementById("accusedButton").style.backgroundColor = "";
    document.getElementById("accuserButton").classList.remove("active");
    document.getElementById("accuserButton").style.backgroundColor = "";
    activeButton = "showAll";
    restoreTestimonyGraph();
  });
});