import {Box} from '@material-ui/core';
import {Button} from '@wandb/weave/components/Button';
import {Tailwind} from '@wandb/weave/components/Tailwind';
import React, {useEffect, useMemo, useRef, useState} from 'react';

import {buildCompositeMetricsMap} from '../../compositeMetricsUtil';
import {
  BOX_RADIUS,
  PLOT_HEIGHT,
  PLOT_PADDING,
  STANDARD_BORDER,
  STANDARD_PADDING,
} from '../../ecpConstants';
import {getOrderedCallIds} from '../../ecpState';
import {EvaluationComparisonState} from '../../ecpState';
import {
  flattenedDimensionPath,
  resolveSummaryMetricValueForEvaluateCall,
} from '../../ecpUtil';
import {HorizontalBox, VerticalBox} from '../../Layout';
import {MetricsSelector} from './MetricsSelector';
import {PlotlyBarPlot} from './PlotlyBarPlot';
import {PlotlyRadarPlot, RadarPlotData} from './PlotlyRadarPlot';

/**
 * Summary plots produce plots to summarize evaluation comparisons.
 */
export const SummaryPlots: React.FC<{
  state: EvaluationComparisonState;
  setSelectedMetrics: (newModel: Record<string, boolean>) => void;
}> = ({state, setSelectedMetrics}) => {
  const {radarData, allMetricNames} = usePlotDataFromMetrics(state);
  const {selectedMetrics} = state;

  // Initialize selectedMetrics if null
  useEffect(() => {
    if (selectedMetrics == null) {
      setSelectedMetrics(
        Object.fromEntries(Array.from(allMetricNames).map(m => [m, true]))
      );
    }
  }, [selectedMetrics, setSelectedMetrics, allMetricNames]);

  const filteredData = useFilteredData(radarData, selectedMetrics);
  const normalizedRadarData = normalizeDataForRadarPlot(filteredData);
  const barPlotData = useBarPlotData(filteredData);

  const {
    containerRef,
    isInitialRender,
    plotsPerPage,
    currentPage,
    setCurrentPage,
  } = useContainerDimensions();

  const handleCloseMetric = React.useCallback(
    (metric: string) => {
      if (selectedMetrics) {
        setSelectedMetrics({
          ...selectedMetrics,
          [metric]: false,
        });
      }
    },
    [setSelectedMetrics, selectedMetrics]
  );

  const {plotsToShow, totalPlots, startIndex, endIndex, totalPages} =
    usePaginatedPlots(
      normalizedRadarData,
      barPlotData,
      plotsPerPage,
      currentPage,
      handleCloseMetric
    );

  // Render placeholder during initial render
  if (isInitialRender) {
    return <div ref={containerRef} style={{width: '100%', height: '400px'}} />;
  }

  return (
    <VerticalBox
      sx={{
        paddingLeft: STANDARD_PADDING,
        paddingRight: STANDARD_PADDING,
        // flex: '1 1 auto',
        width: '100%',
        gridGap: STANDARD_PADDING / 2,
      }}>
      <HorizontalBox
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
        <div style={{display: 'flex', alignItems: 'center'}}>
          <MetricsSelector
            selectedMetrics={selectedMetrics}
            setSelectedMetrics={setSelectedMetrics}
            allMetrics={Array.from(allMetricNames)}
          />
        </div>
        <div style={{display: 'flex', alignItems: 'center'}}>
          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            startIndex={startIndex}
            endIndex={endIndex}
            totalPlots={totalPlots}
            onPrevPage={() => setCurrentPage(prev => Math.max(prev - 1, 0))}
            onNextPage={() =>
              setCurrentPage(prev => Math.min(prev + 1, totalPages - 1))
            }
          />
        </div>
      </HorizontalBox>

      <div ref={containerRef} style={{width: '100%'}}>
        <HorizontalBox>{plotsToShow}</HorizontalBox>
      </div>
    </VerticalBox>
  );
};

const RadarPlotBox: React.FC<{data: RadarPlotData}> = ({data}) => (
  <Box
    sx={{
      height: PLOT_HEIGHT,
      width: PLOT_HEIGHT * 1.5,
      borderRadius: BOX_RADIUS,
      border: STANDARD_BORDER,
      padding: PLOT_PADDING,
      flex: '1 0 auto',
    }}>
    <PlotlyRadarPlot height={PLOT_HEIGHT} data={data} />
  </Box>
);

const BarPlotBox: React.FC<{
  plot: {plotlyData: Plotly.Data; yRange: [number, number]; metric: string};
  onClose: (metric: string) => void;
}> = ({plot, onClose}) => (
  <Box
    sx={{
      position: 'relative',
      height: PLOT_HEIGHT,
      width: PLOT_HEIGHT,
      borderRadius: BOX_RADIUS,
      border: STANDARD_BORDER,
      paddingTop: PLOT_PADDING - 30,
      paddingBottom: PLOT_PADDING,
      paddingLeft: PLOT_PADDING,
      paddingRight: PLOT_PADDING,
      flex: '1 1 auto',
    }}>
    <Button
      variant="ghost"
      size="small"
      style={{
        position: 'absolute',
        top: 4,
        right: 4,
        minWidth: 0,
        width: 24,
        height: 24,
        padding: 0,
        zIndex: 1,
      }}
      onClick={() => onClose(plot.metric)}
      icon="close"
      aria-label={`Hide ${plot.metric}`}
    />
    <PlotlyBarPlot
      height={PLOT_HEIGHT}
      plotlyData={plot.plotlyData}
      yRange={plot.yRange}
    />
  </Box>
);

const PaginationControls: React.FC<{
  currentPage: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  totalPlots: number;
  onPrevPage: () => void;
  onNextPage: () => void;
}> = ({
  currentPage,
  totalPages,
  startIndex,
  endIndex,
  totalPlots,
  onPrevPage,
  onNextPage,
}) => (
  <HorizontalBox sx={{width: '100%'}}>
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Tailwind>
        <div className="flex items-center">
          <Button
            variant="ghost"
            onClick={onPrevPage}
            disabled={currentPage === 0}
            icon="chevron-next"
            className="rotate-180"
          />
          <span className="mx-2 pb-2 text-sm text-moon-500">
            {startIndex}-{endIndex} of {totalPlots}
          </span>
          <Button
            variant="ghost"
            onClick={onNextPage}
            disabled={currentPage === totalPages - 1}
            icon="chevron-next"
          />
        </div>
      </Tailwind>
    </Box>
  </HorizontalBox>
);

const useFilteredData = (
  radarData: RadarPlotData,
  selectedMetrics: Record<string, boolean> | undefined
) =>
  useMemo(() => {
    const data: RadarPlotData = {};
    for (const [callId, metricBin] of Object.entries(radarData)) {
      const metrics: {[metric: string]: number} = {};
      for (const [metric, value] of Object.entries(metricBin.metrics)) {
        if (selectedMetrics?.[metric]) {
          metrics[metric] = value;
        }
      }
      if (Object.keys(metrics).length > 0) {
        data[callId] = {
          metrics,
          name: metricBin.name,
          color: metricBin.color,
        };
      }
    }
    return data;
  }, [radarData, selectedMetrics]);

function getMetricValuesMap(radarData: RadarPlotData): {
  [metric: string]: number[];
} {
  const metricValues: {[metric: string]: number[]} = {};
  Object.values(radarData).forEach(callData => {
    Object.entries(callData.metrics).forEach(([metric, value]) => {
      if (!metricValues[metric]) {
        metricValues[metric] = [];
      }
      metricValues[metric].push(value);
    });
  });
  return metricValues;
}

function normalizeMetricValues(values: number[]): {
  normalizedValues: number[];
  normalizer: number;
} {
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (min === max) {
    return {
      normalizedValues: values.map(() => 0.5),
      normalizer: 1,
    };
  }

  // Handle negative values by shifting
  const shiftedValues = min < 0 ? values.map(v => v - min) : values;
  const maxValue = min < 0 ? max - min : max;

  const maxPower = Math.ceil(Math.log2(maxValue));
  const normalizer = Math.pow(2, maxPower);

  return {
    normalizedValues: shiftedValues.map(v => v / normalizer),
    normalizer,
  };
}

function normalizeDataForRadarPlot(
  radarDataOriginal: RadarPlotData
): RadarPlotData {
  const radarData = Object.fromEntries(
    Object.entries(radarDataOriginal).map(([callId, callData]) => [
      callId,
      {...callData, metrics: {...callData.metrics}},
    ])
  );

  const metricValues = getMetricValuesMap(radarData);

  // Normalize each metric independently
  Object.entries(metricValues).forEach(([metric, values]) => {
    const {normalizedValues} = normalizeMetricValues(values);
    Object.values(radarData).forEach((callData, index) => {
      callData.metrics[metric] = normalizedValues[index];
    });
  });

  return radarData;
}

const useBarPlotData = (filteredData: RadarPlotData) =>
  useMemo(() => {
    const metrics: {
      [metric: string]: {
        callIds: string[];
        values: number[];
        name: string;
        colors: string[];
      };
    } = {};

    // Reorganize data by metric instead of by call
    for (const [callId, metricBin] of Object.entries(filteredData)) {
      for (const [metric, value] of Object.entries(metricBin.metrics)) {
        if (!metrics[metric]) {
          metrics[metric] = {callIds: [], values: [], name: metric, colors: []};
        }
        metrics[metric].callIds.push(callId);
        metrics[metric].values.push(value);
        metrics[metric].colors.push(metricBin.color);
      }
    }

    // Convert metrics object to Plotly data format
    return Object.entries(metrics).map(([metric, metricBin]) => {
      const maxY = Math.max(...metricBin.values) * 1.1;
      const minY = Math.min(...metricBin.values, 0);
      const plotlyData: Plotly.Data = {
        type: 'bar',
        y: metricBin.values,
        x: metricBin.callIds,
        text: metricBin.values.map(value =>
          Number.isInteger(value) ? value.toString() : value.toFixed(3)
        ),
        textposition: 'outside',
        textfont: {size: 14, color: 'black'},
        name: metric,
        marker: {color: metricBin.colors},
      };
      return {plotlyData, yRange: [minY, maxY] as [number, number], metric};
    });
  }, [filteredData]);

const useContainerDimensions = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isInitialRender, setIsInitialRender] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();
    setIsInitialRender(false);

    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const plotsPerPage = useMemo(() => {
    return Math.max(1, Math.floor(containerWidth / PLOT_HEIGHT));
  }, [containerWidth]);

  return {
    containerRef,
    isInitialRender,
    plotsPerPage,
    currentPage,
    setCurrentPage,
  };
};

const usePaginatedPlots = (
  filteredData: RadarPlotData,
  barPlotData: Array<{
    plotlyData: Plotly.Data;
    yRange: [number, number];
    metric: string;
  }>,
  plotsPerPage: number,
  currentPage: number,
  onClose: (metric: string) => void
) => {
  const radarPlotWidth = 2;
  const totalBarPlots = barPlotData.length;
  const totalPlotWidth = radarPlotWidth + totalBarPlots;
  const totalPages = Math.ceil(totalPlotWidth / plotsPerPage);

  const plotsToShow = useMemo(() => {
    // First page always shows radar plot
    if (currentPage === 0) {
      const availableSpace = plotsPerPage - radarPlotWidth;
      return [
        <RadarPlotBox key="radar" data={filteredData} />,
        ...barPlotData
          .slice(0, availableSpace)
          .map((plot, index) => (
            <BarPlotBox key={`bar-${index}`} plot={plot} onClose={onClose} />
          )),
      ];
    } else {
      // Subsequent pages show only bar plots
      const startIdx =
        (currentPage - 1) * plotsPerPage + (plotsPerPage - radarPlotWidth);
      const endIdx = startIdx + plotsPerPage;
      return barPlotData
        .slice(startIdx, endIdx)
        .map((plot, index) => (
          <BarPlotBox
            key={`bar-${startIdx + index}`}
            plot={plot}
            onClose={onClose}
          />
        ));
    }
  }, [currentPage, plotsPerPage, filteredData, barPlotData, onClose]);

  // Calculate pagination details
  const totalPlots = barPlotData.length + 1; // +1 for the radar plot
  const startIndex =
    currentPage === 0 ? 1 : Math.min(plotsPerPage + 1, totalPlots);
  const endIndex =
    currentPage === 0
      ? Math.min(plotsToShow.length, totalPlots)
      : Math.min(startIndex + plotsToShow.length - 1, totalPlots);

  return {plotsToShow, totalPlots, startIndex, endIndex, totalPages};
};

const usePlotDataFromMetrics = (
  state: EvaluationComparisonState
): {radarData: RadarPlotData; allMetricNames: Set<string>} => {
  const compositeMetrics = useMemo(() => {
    return buildCompositeMetricsMap(state.summary, 'summary');
  }, [state]);
  const callIds = useMemo(() => {
    return getOrderedCallIds(state);
  }, [state]);

  return useMemo(() => {
    const metrics = Object.values(compositeMetrics)
      .map(scoreGroup => Object.values(scoreGroup.metrics))
      .flat()
      .map(metric => {
        const values = callIds.map(callId => {
          const metricDimension = Object.values(metric.scorerRefs).find(
            scorerRefData => scorerRefData.evalCallIds.includes(callId)
          )?.metric;
          if (!metricDimension) {
            return undefined;
          }
          const val = resolveSummaryMetricValueForEvaluateCall(
            metricDimension,
            state.summary.evaluationCalls[callId]
          );
          if (typeof val === 'boolean') {
            return val ? 1 : 0;
          } else {
            return val;
          }
        });
        const evalScores: {[evalCallId: string]: number | undefined} =
          Object.fromEntries(callIds.map((key, i) => [key, values[i]]));

        const metricLabel = flattenedDimensionPath(
          Object.values(metric.scorerRefs)[0].metric
        );
        return {
          metricLabel,
          evalScores,
        };
      });
    const radarData = Object.fromEntries(
      callIds.map(callId => {
        const evalCall = state.summary.evaluationCalls[callId];
        return [
          evalCall.callId,
          {
            name: evalCall.name,
            color: evalCall.color,
            metrics: Object.fromEntries(
              metrics.map(metric => {
                return [
                  metric.metricLabel,
                  metric.evalScores[evalCall.callId] ?? 0,
                ];
              })
            ),
          },
        ];
      })
    );
    const allMetricNames = new Set(metrics.map(m => m.metricLabel));
    return {radarData, allMetricNames};
  }, [callIds, compositeMetrics, state.summary.evaluationCalls]);
};
