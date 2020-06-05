/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
import React from 'react';
import { i18n } from '@kbn/i18n';
import styled, { useTheme } from 'styled-components';
import { EuiBadge } from '@elastic/eui';
import { px } from '../../../../public/style/variables';
import { units } from '../../../style/variables';

interface Props {
  count: number;
}

const Badge = (styled(EuiBadge)`
  margin-top: ${px(units.eighth)};
` as unknown) as typeof EuiBadge;

export const ErrorCountSummaryItemBadge = ({ count }: Props) => {
  const theme = useTheme();

  return (
    <Badge color={theme.eui.euiColorDanger}>
      {i18n.translate('xpack.apm.transactionDetails.errorCount', {
        defaultMessage:
          '{errorCount, number} {errorCount, plural, one {Error} other {Errors}}',
        values: { errorCount: count },
      })}
    </Badge>
  );
}
